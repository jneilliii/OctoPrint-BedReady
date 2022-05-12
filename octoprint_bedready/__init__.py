# coding=utf-8
from __future__ import absolute_import

import flask
import octoprint.plugin
import requests
import os
import datetime
from octoprint.events import Events


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
            take_snapshot=[]
        )

    def on_api_command(self, command, data):
        import flask

        if command == "take_snapshot":
            if data.get("test", False):
                relative_url = self.take_snapshot("test.jpg", "test_image")
                if "test_image" in relative_url:
                    similarity = self.compare_images(os.path.join(self.get_plugin_data_folder(), "reference.jpg"), relative_url["test_image"])
                    return flask.jsonify({"test_image": relative_url["url"], "similarity": round(similarity, 4)})
                else:
                    return flask.jsonify({"error": relative_url})
            else:
                relative_url = self.take_snapshot("reference.jpg")
                if "reference_image" in relative_url:
                    reference_image_timestamp = "{:%m/%d/%Y %H:%M:%S}".format(datetime.datetime.now())
                    self._settings.set(["reference_image"], relative_url["url"])
                    self._settings.set(["reference_image_timestamp"], reference_image_timestamp)
                    relative_url["reference_image_timestamp"] = reference_image_timestamp
                    self._settings.save()
                return flask.jsonify(relative_url)

    def take_snapshot(self, filename=None, filetype="reference_image"):
        snapshot_url = self._settings.global_get(["webcam", "snapshot"])
        if snapshot_url == "" or not filename or not snapshot_url.startswith("http"):
            return {"error": "missing or incorrect snapshot url in webcam & timelapse settings."}

        download_file_name = os.path.join(self.get_plugin_data_folder(), filename)
        response = requests.get(snapshot_url, timeout=20)
        if response.status_code == 200:
            with open(download_file_name, "wb") as f:
                f.write(response.content)
            if os.path.exists(download_file_name):
                return {filetype: download_file_name, "url": "plugin/bedready/images/{}?{:%Y%m%d%H%M%S}".format(filename, datetime.datetime.now())}
            else:
                return {"error": "unable to save file."}
        else:
            return {"error": "unable to download snapshot."}

    # ~~ SettingsPlugin mixin

    def get_settings_defaults(self):
        return {
            "reference_image": "",
            "reference_image_timestamp": "",
            "match_percentage": 0.98,
            "cancel_print": False
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
        if command != "BEDREADY" or self._settings.get(["reference_image"]) == "":
            return

        with self._printer.job_on_hold():
            try:
                message = self.check_bed()
                self._logger.debug("match: {}".format(message))
                if not message.get("bed_clear"):
                    if self._settings.get_boolean(["cancel_print"]):
                        self._printer.cancel_print(tags={self._identifier})
                    else:
                        self._printer.pause_print(tags={self._identifier})
                self._plugin_manager.send_plugin_message(self._identifier, message)
            except Exception as e:
                self._logger.info(e)

    def check_bed(self):
        comparison_image = self.take_snapshot("compare.jpg", "comparison_image")
        if "error" in comparison_image:
            self._logger.error(comparison_image["error"])
            return
        self._logger.debug("file saved: {}".format(comparison_image))
        similarity = self.compare_images(os.path.join(self.get_plugin_data_folder(), "reference.jpg"), comparison_image["comparison_image"])
        return {"bed_clear": similarity > self._settings.get_float(["match_percentage"]), "similarity": round(similarity, 4)}

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
    __plugin_helpers__ = {'check_bed': __plugin_implementation__.check_bed}
