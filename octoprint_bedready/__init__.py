# coding=utf-8
from __future__ import absolute_import

import flask
import octoprint.plugin
import requests
import os
from datetime import datetime
from pathlib import Path
from octoprint.events import Events
from octoprint.filemanager import FileDestinations

TEST_FILENAME = "test.jpg"
COMPARISON_FILENAME = "comparison.jpg"

class SnapshotError(Exception):
    pass

class BedReadyPlugin(octoprint.plugin.SettingsPlugin,
                     octoprint.plugin.AssetPlugin,
                     octoprint.plugin.TemplatePlugin,
                     octoprint.plugin.SimpleApiPlugin,
                     octoprint.plugin.EventHandlerPlugin
                     ):

    # ~~ EventHandlerPlugin mixin

    def on_event(self, event, payload):
        if event == Events.PRINT_RESUMED or event == Events.PRINT_CANCELLED and not self._settings.get_boolean(["cancel_print"]):
            self._plugin_manager.send_plugin_message(self._identifier, {"bed_clear": True})

    # ~~ SimpleApiPlugin mixin

    def get_api_commands(self):
        return dict(
            take_snapshot=[],
            check_bed=[],
            list_snapshots=[],
            delete_snapshot=["filename"],
        )

    def get_snapshots(self):
        return [f for f in os.listdir(self.get_plugin_data_folder())
                if os.path.isfile(os.path.join(self.get_plugin_data_folder(), f))
                and os.path.splitext(f)[1] == '.jpg'
                and not f in (TEST_FILENAME, COMPARISON_FILENAME)
            ]

    def on_api_command(self, command, data):
        import flask
        if command == "take_snapshot":
            try:
                self.take_snapshot(data.get("name"), data.get("enable_mask"), data.get("mask_points"))
            except Exception as e:
                return flask.jsonify(dict(error=str(e)))
            return flask.jsonify(self.get_snapshots())
        elif command == "check_bed":
            try:
                result = self.check_bed(data.get("reference"), data.get("similarity"))
                return flask.jsonify(result)
            except Exception as e:
                return flask.jsonify(dict(error=str(e)))
        elif command == "list_snapshots":
            return flask.jsonify(self.get_snapshots())
        elif command == "delete_snapshot":
            p = Path(self.get_plugin_data_folder()) / data.get("filename")
            if not p.relative_to(self.get_plugin_data_folder()):
                raise ValueError("Path is outside of plugin data folder")
            elif not p.exists() or not p.is_file():
                raise ValueError("Path is not a file")
            p.unlink()

    def take_snapshot(self, filename=None, enable_mask=None, mask_points=None):
        snapshot_url = self._settings.global_get(["webcam", "snapshot"])
        if snapshot_url == "" or not filename or not snapshot_url.startswith("http"):
            raise ValueError("missing or incorrect snapshot url in webcam & timelapse settings.")

        if enable_mask is None:
            enable_mask = self._settings.get_boolean(["enable_mask"])
        if mask_points is None:
            mask_points = self._settings.get(["mask_points"])
        filename = self._file_manager.sanitize_name(FileDestinations.LOCAL, filename)

        self._logger.debug(f"snapshot_url: {snapshot_url}, filename: {filename}, enable_mask: {enable_mask}, mask_points: {mask_points}")

        download_file_name = os.path.join(self.get_plugin_data_folder(), filename)
        response = requests.get(snapshot_url, timeout=20)
        if response.status_code == 200:
            if bool(enable_mask) is True:
                self._logger.debug("using mask")
                import cv2
                import numpy as np
                imagearray = np.asarray(bytearray(response.content), dtype="uint8")
                tempimage = cv2.imdecode(imagearray, cv2.IMREAD_COLOR)
                maskpointsseperated = mask_points.split(':')
                points = np.empty((0, 2), dtype=int)
                for point in maskpointsseperated:
                    points = np.append(points, np.fromstring(point, dtype=int, sep=',').reshape(1, 2), axis=0)
                mask = np.zeros(tempimage.shape[:2], dtype="uint8")
                cv2.fillPoly(mask, pts=[points], color=(255, 255, 255))
                masked = cv2.bitwise_and(tempimage, tempimage, mask=mask)
                writestatus = cv2.imwrite(download_file_name, masked)
                if writestatus == True:
                    return None
                else:
                    raise SnapshotError("unable to save file.")
            else:
                self._logger.debug("not using mask")
                with open(download_file_name, "wb") as f:
                    f.write(response.content)
                if os.path.exists(download_file_name):
                    return None
                else:
                    raise SnapshotError("unable to save file.")
        else:
            raise SnapshotError("unable to download snapshot.")

    # ~~ SettingsPlugin mixin

    def get_settings_defaults(self):
        return {
            "reference_image": "",
            "match_percentage": 0.98,
            "cancel_print": False,
            "enable_mask": False,
            "mask_points": "20,20:620,20:580,400:80,400"
        }

    # ~~ AssetPlugin mixin

    def get_assets(self):
        return {
            "css": ["css/bedready.css"],
            "js": ["js/bedready.js"]
        }

    # ~~ TemplatePlugin mixin

    def get_template_vars(self):
        return {"plugin_version": self._plugin_version}

    # ~~ Route hook

    def route_hook(self, server_routes, *args, **kwargs):
        from octoprint.server.util.tornado import LargeResponseHandler, path_validation_factory
        from octoprint.util import is_hidden_path
        return [
            (r"/images/(.*)", LargeResponseHandler, dict(path=self.get_plugin_data_folder(),
                                                         as_attachment=True,
                                                         path_validation=path_validation_factory(
                                                             lambda path: not is_hidden_path(path), status_code=404)))
        ]

    def compare_images(self, reference_image, comparison_image):
        import cv2
        reference_image = cv2.imread(reference_image)
        comparison_image = cv2.imread(comparison_image)
        height, width, channels = reference_image.shape
        pixel_difference = cv2.norm(reference_image, comparison_image, cv2.NORM_L2)
        return 1 - pixel_difference / (height * width)

    # ~~ @ command hook

    def process_at_command(self, comm, phase, command, parameters, tags=None, *args, **kwargs):
        if command.upper() != "BEDREADY":
            return

        reference = None
        match_percentage = None
        parameters = parameters.split()
        if len(parameters) > 0:
            reference = parameters[0]
        if len(parameters) > 1:
            match_percentage = float(parameters[1])

        with self._printer.job_on_hold():
            try:
                message = self.check_bed(reference, match_percentage)
                self._logger.debug(f"match: {message}")
                if not message.get("bed_clear"):
                    if self._settings.get_boolean(["cancel_print"]):
                        self._printer.cancel_print(tags={self._identifier})
                    else:
                        self._printer.pause_print(tags={self._identifier})
                self._plugin_manager.send_plugin_message(self._identifier, message)
            except Exception as e:
                self._logger.info(e)

    def check_bed(self, reference=None, match_percentage=None):
        if reference == None:
            reference = self._settings.get(["reference_image"])
        if match_percentage == None:
            match_percentage = self._settings.get_float(["match_percentage"])

        self._logger.info(f"check_bed with reference {reference} (threshold {match_percentage})")
        self.take_snapshot(COMPARISON_FILENAME)
        similarity = self.compare_images(
            os.path.join(self.get_plugin_data_folder(), reference),
            os.path.join(self.get_plugin_data_folder(), COMPARISON_FILENAME))
        timestamp = datetime.now()
        return {"bed_clear": similarity > match_percentage, "test_image": f"{COMPARISON_FILENAME}?{timestamp:%Y%m%d%H%M%S}", "reference_image": reference, "similarity": round(similarity, 4)}

    # ~~ Softwareupdate hook

    def get_update_information(self):
        return {
            "bedready": {
                "displayName": "Bed Ready",
                "displayVersion": self._plugin_version,

                # version check: github repository
                "type": "github_release",
                "user": "jneilliii",
                "repo": "OctoPrint-BedReady",
                "current": self._plugin_version,

                # update method: pip
                "pip": "https://github.com/jneilliii/OctoPrint-BedReady/archive/{target_version}.zip",
            }
        }


__plugin_name__ = "Bed Ready"
__plugin_pythoncompat__ = ">=3.6,<4"  # Only Python 3


def __plugin_load__():
    global __plugin_implementation__
    __plugin_implementation__ = BedReadyPlugin()

    global __plugin_hooks__
    __plugin_hooks__ = {
        "octoprint.plugin.softwareupdate.check_config": __plugin_implementation__.get_update_information,
        "octoprint.server.http.routes": __plugin_implementation__.route_hook,
        "octoprint.comm.protocol.atcommand.queuing": __plugin_implementation__.process_at_command
    }

    global __plugin_helpers__
    __plugin_helpers__ = {
            'check_bed': __plugin_implementation__.check_bed,
            'take_snapshot': __plugin_implementation__.take_snapshot,
            }
