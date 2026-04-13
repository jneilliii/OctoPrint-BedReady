# coding=utf-8
from __future__ import absolute_import

import flask
import octoprint.plugin
import requests
import os
import datetime
from pathlib import Path
from octoprint.events import Events
from octoprint.util.files import sanitize_filename
from octoprint.webcams import get_snapshot_webcam

TEST_FILENAME = "test.jpg"
COMPARISON_FILENAME = "comparison.jpg"

# for images taken with the BEDREADY_CAPTURE command
REFERENCE_FILENAME = "reference.jpg"

# for debug comparison images
DEBUG_IMAGE_PREFIX = "debug_comparison_"
MAX_DEBUG_IMAGES = 5

class SnapshotError(Exception):
    pass

class BedReadyPlugin(octoprint.plugin.SettingsPlugin,
                     octoprint.plugin.AssetPlugin,
                     octoprint.plugin.TemplatePlugin,
                     octoprint.plugin.SimpleApiPlugin,
                     octoprint.plugin.EventHandlerPlugin
                     ):

    # ~~ Helper methods

    def normalize_image_path(self, path):
        """
        Normalize image paths for backwards compatibility.
        Removes 'plugin/bedready/images/' prefix if it exists (from older versions).
        Handles paths with or without leading slashes.
        """
        if not path:
            return ''
        # Remove leading slash if present
        clean_path = path.lstrip('/')
        prefix = 'plugin/bedready/images/'
        # Remove the prefix if it exists
        if clean_path.startswith(prefix):
            clean_path = clean_path[len(prefix):]
        return clean_path

    # ~~ EventHandlerPlugin mixin

    def on_event(self, event, payload):
        if event == Events.PRINT_RESUMED or event == Events.PRINT_CANCELLED and not self._settings.get_boolean(["cancel_print"]):
            self._plugin_manager.send_plugin_message(self._identifier, {"bed_clear": True})

    def get_snapshot_url(self):
        """Return snapshot URL from OctoPrint 1.9+ webcam config."""
        webcam = get_snapshot_webcam()
        if webcam is None:
            return ""
        try:
            snapshot_url = webcam.config.compat.snapshot
        except AttributeError as e:
            return ""

        return snapshot_url

    # ~~ SimpleApiPlugin mixin

    def get_api_commands(self):
        return dict(
            take_snapshot=[],
            check_bed=[],
            list_snapshots=[],
            delete_snapshot=["filename"],
            get_image_dimensions=["filename"],
            list_debug_images=[],
            delete_debug_image=["filename"],
            snapshot_status=[],
        )

    def is_api_protected(self):
        return True

    def get_snapshots(self):
        return [f for f in os.listdir(self.get_plugin_data_folder())
                if os.path.isfile(os.path.join(self.get_plugin_data_folder(), f))
                and os.path.splitext(f)[1] == '.jpg'
                and not f in (TEST_FILENAME, COMPARISON_FILENAME)
                and not f.startswith(DEBUG_IMAGE_PREFIX)
            ]

    def get_debug_images(self):
        """Get list of debug comparison images with their metadata."""
        debug_files = [f for f in os.listdir(self.get_plugin_data_folder())
                      if os.path.isfile(os.path.join(self.get_plugin_data_folder(), f))
                      and f.startswith(DEBUG_IMAGE_PREFIX)
                      and os.path.splitext(f)[1] == '.jpg']

        # Sort by timestamp (newest first)
        debug_files.sort(reverse=True)

        # Parse metadata from filenames: debug_comparison_YYYYMMDD_HHMMSS_threshold.jpg
        debug_info = []
        for f in debug_files:
            try:
                # Extract timestamp and threshold from filename
                parts = f.replace(DEBUG_IMAGE_PREFIX, '').replace('.jpg', '').split('_')
                # Expect at least date, time, and one threshold component
                if len(parts) >= 3:
                    date_part = parts[0]
                    time_part = parts[1]
                    # Reconstruct threshold from remaining parts.
                    # Example:
                    #   ["YYYYMMDD", "HHMMSS", "0", "9842"]       -> "0.9842"
                    #   ["YYYYMMDD", "HHMMSS", "0", "9842", "0"]  -> "0.98420"
                    if len(parts) > 3:
                        threshold_str = f"{parts[2]}.{''.join(parts[3:])}"
                    else:
                        threshold_str = parts[2]
                    threshold = float(threshold_str)
                    timestamp = f"{date_part}_{time_part}"
                    debug_info.append({
                        'filename': f,
                        'timestamp': timestamp,
                        'threshold': threshold
                    })
            except Exception as e:
                # Skip files that don't match expected format, but log at debug level for troubleshooting
                self._logger.debug("Skipping debug image with unexpected format '%s': %s", f, e)

        return debug_info

    def store_debug_image(self, comparison_image_path, threshold):
        """Store a debug comparison image with threshold in filename."""
        if not self._settings.get_boolean(["debug_mode"]):
            return

        # Create filename with timestamp and threshold
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        # Format threshold to 4 decimal places, replacing . with underscore for filename
        threshold_str = f"{threshold:.4f}".replace('.', '_')
        debug_filename = f"{DEBUG_IMAGE_PREFIX}{timestamp}_{threshold_str}.jpg"
        debug_path = os.path.join(self.get_plugin_data_folder(), debug_filename)

        # Copy the comparison image
        import shutil
        shutil.copy2(comparison_image_path, debug_path)

        # Clean up old debug images (keep only last MAX_DEBUG_IMAGES)
        debug_images = self.get_debug_images()
        if len(debug_images) > MAX_DEBUG_IMAGES:
            # Delete oldest images (they're sorted newest first)
            for img in debug_images[MAX_DEBUG_IMAGES:]:
                try:
                    old_path = os.path.join(self.get_plugin_data_folder(), img['filename'])
                    os.unlink(old_path)
                    self._logger.info(f"Deleted old debug image: {img['filename']}")
                except Exception as e:
                    self._logger.error(f"Error deleting old debug image: {e}")

    def on_api_command(self, command, data):
        import flask
        if command == "take_snapshot":
            try:
                self.take_snapshot(sanitize_filename(data.get("name")))
            except Exception as e:
                return flask.jsonify(dict(error=str(e)))
            return flask.jsonify(self.get_snapshots())
        elif command == "check_bed":
            try:
                # Extract crop coordinates from request if provided (for live preview testing)
                crop_coords = {
                    'crop_x1': data.get("crop_x1"),
                    'crop_y1': data.get("crop_y1"),
                    'crop_x2': data.get("crop_x2"),
                    'crop_y2': data.get("crop_y2"),
                    'crop_x3': data.get("crop_x3"),
                    'crop_y3': data.get("crop_y3"),
                    'crop_x4': data.get("crop_x4"),
                    'crop_y4': data.get("crop_y4"),
                }
                result = self.check_bed(data.get("reference"), data.get("similarity"), crop_coords=crop_coords)
                return flask.jsonify(result)
            except Exception as e:
                return flask.jsonify(dict(error=str(e)))
        elif command == "list_snapshots":
            return flask.jsonify(self.get_snapshots())
        elif command == "delete_snapshot":
            filename = data.get("filename")
            if not filename:
                raise ValueError("Filename is required")
            p = Path(self.get_plugin_data_folder()) / filename
            try:
                p.relative_to(self.get_plugin_data_folder())
            except ValueError:
                raise ValueError("Path is outside of plugin data folder")
            if not p.exists() or not p.is_file():
                raise ValueError("Path is not a file")
            p.unlink()
            return flask.jsonify(self.get_snapshots())
        elif command == "get_image_dimensions":
            try:
                import cv2
                filename = data.get("filename")
                if not filename:
                    return flask.jsonify(dict(error="Filename is required"))
                # Normalize path for backwards compatibility
                filename = self.normalize_image_path(filename)
                base_path = Path(self.get_plugin_data_folder())
                image_path = base_path / filename
                try:
                    # Ensure the path is within the plugin data folder
                    image_path.relative_to(base_path)
                except ValueError:
                    return flask.jsonify(dict(error="Path is outside of plugin data folder"))
                if not image_path.exists() or not image_path.is_file():
                    return flask.jsonify(dict(error="Path is not a file"))
                img = cv2.imread(str(image_path))

                if img is None:
                    return flask.jsonify(dict(error="Unable to read image"))
                height, width = img.shape[:2]
                return flask.jsonify(dict(width=width, height=height))
            except Exception as e:
                return flask.jsonify(dict(error=str(e)))
        elif command == "list_debug_images":
            return flask.jsonify(self.get_debug_images())
        elif command == "delete_debug_image":
            filename = data.get("filename")
            if not filename:
                raise ValueError("Filename is required")
            p = Path(self.get_plugin_data_folder()) / filename
            try:
                p.relative_to(self.get_plugin_data_folder())
            except ValueError:
                raise ValueError("Path is outside of plugin data folder")
            if not p.exists() or not p.is_file():
                raise ValueError("Path is not a file")
            if not p.name.startswith(DEBUG_IMAGE_PREFIX):
                raise ValueError("Can only delete debug images")
            p.unlink()
            return flask.jsonify(self.get_debug_images())

    def take_snapshot(self, filename=None):
        snapshot_url = self.get_snapshot_url()
        if snapshot_url == "" or not filename or not snapshot_url.startswith("http"):
            raise ValueError("missing or incorrect webcam snapshot url in OctoPrint webcam settings.")

        download_file_name = os.path.join(self.get_plugin_data_folder(), filename)
        response = requests.get(snapshot_url, timeout=20)
        if response.status_code == 200:
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
            "crop_x1": 0,
            "crop_y1": 0,
            "crop_x2": 0,
            "crop_y2": 0,
            "crop_x3": 0,
            "crop_y3": 0,
            "crop_x4": 0,
            "crop_y4": 0,
            "debug_mode": False
        }

    def get_settings_version(self):
        return 1

    def on_settings_migrate(self, target, current=None):
        """Migrate settings to newer versions, including path normalization for backwards compatibility."""
        if current is None or current < 1:
            # Migrate old image paths from versions before path normalization (version 0 -> 1)
            if current < 1:
                reference_image = self._settings.get(["reference_image"])
                if reference_image:
                    normalized = self.normalize_image_path(reference_image)
                    if normalized != reference_image:
                        self._logger.info(f"Migrating reference_image from '{reference_image}' to '{normalized}'")
                        self._settings.set(["reference_image"], normalized)

    def on_settings_load(self):
        """Load settings and normalize any old image paths."""
        data = octoprint.plugin.SettingsPlugin.on_settings_load(self)
        # Normalize the reference_image path when loading settings
        if data.get("plugins", {}).get("bedready", {}).get("reference_image"):
            old_path = data["plugins"]["bedready"]["reference_image"]
            normalized = self.normalize_image_path(old_path)
            if normalized != old_path:
                self._logger.debug(f"Normalizing reference_image path on load: {old_path} -> {normalized}")
                data["plugins"]["bedready"]["reference_image"] = normalized
        return data

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

    def compare_images(self, reference_image, comparison_image, crop_coords=None):
        import cv2
        import numpy as np
        reference_image = cv2.imread(reference_image)
        comparison_image = cv2.imread(comparison_image)
        if reference_image is None or comparison_image is None:
            raise ValueError("Failed to load reference or comparison image for comparison.")

        # Get crop coordinates from provided parameter or fall back to settings
        if crop_coords and any(crop_coords.values()):
            x1 = crop_coords.get('crop_x1', 0) or 0
            y1 = crop_coords.get('crop_y1', 0) or 0
            x2 = crop_coords.get('crop_x2', 0) or 0
            y2 = crop_coords.get('crop_y2', 0) or 0
            x3 = crop_coords.get('crop_x3', 0) or 0
            y3 = crop_coords.get('crop_y3', 0) or 0
            x4 = crop_coords.get('crop_x4', 0) or 0
            y4 = crop_coords.get('crop_y4', 0) or 0
        else:
            x1 = self._settings.get_int(["crop_x1"])
            y1 = self._settings.get_int(["crop_y1"])
            x2 = self._settings.get_int(["crop_x2"])
            y2 = self._settings.get_int(["crop_y2"])
            x3 = self._settings.get_int(["crop_x3"])
            y3 = self._settings.get_int(["crop_y3"])
            x4 = self._settings.get_int(["crop_x4"])
            y4 = self._settings.get_int(["crop_y4"])

        # Apply perspective transform if coordinates are set
        if all(coord > 0 for coord in (x1, y1, x2, y2, x3, y3, x4, y4)):
            # Define source points (the quadrilateral in the image)
            src_pts = np.float32([[x1, y1], [x2, y2], [x3, y3], [x4, y4]])

            # Validate that the quadrilateral is non-degenerate (non-zero area)
            x_coords = src_pts[:, 0]
            y_coords = src_pts[:, 1]
            area = 0.5 * abs(
                np.dot(x_coords, np.roll(y_coords, -1))
                - np.dot(y_coords, np.roll(x_coords, -1))
            )
            # Calculate destination rectangle size (bounding box of the quadrilateral)
            width = int(max(np.linalg.norm(src_pts[0] - src_pts[1]), np.linalg.norm(src_pts[2] - src_pts[3])))
            height = int(max(np.linalg.norm(src_pts[1] - src_pts[2]), np.linalg.norm(src_pts[3] - src_pts[0])))
            # Check for valid geometry and positive dimensions before applying transform
            if area <= 1e-3 or width <= 0 or height <= 0:
                self._logger.warning(
                    "Invalid crop coordinates for perspective transform; skipping transform "
                    "(area=%s, width=%s, height=%s)", area, width, height
                )
            else:
                # Define destination points (rectangular output)
                dst_pts = np.float32([[0, 0], [width, 0], [width, height], [0, height]])
                try:
                    # Get perspective transform matrix
                    matrix = cv2.getPerspectiveTransform(src_pts, dst_pts)
                    # Apply transform to both images
                    reference_image = cv2.warpPerspective(reference_image, matrix, (width, height))
                    comparison_image = cv2.warpPerspective(comparison_image, matrix, (width, height))
                except cv2.error as e:
                    self._logger.error("Error applying perspective transform: %s", e)

        height, width, channels = reference_image.shape
        pixel_difference = cv2.norm(reference_image, comparison_image, cv2.NORM_L2)
        return 1 - pixel_difference / (height * width)

    # ~~ @ command hook

    def process_at_command(self, comm, phase, command, parameters, tags=None, *args, **kwargs):
        if command.upper() == "BEDREADY_CAPTURE":
            # Take snapshot and set as reference image
            filename = REFERENCE_FILENAME

            try:
                self.take_snapshot(filename)
                self._settings.set(["reference_image"], filename)
                self._settings.save()
                self._logger.info(f"Reference image set to {filename}")
                self._plugin_manager.send_plugin_message(self._identifier, {
                    "reference_set": True,
                    "reference_image": filename
                })
            except Exception as e:
                self._logger.error(f"Error setting reference image: {e}")
                self._plugin_manager.send_plugin_message(self._identifier, {
                    "reference_set": False,
                    "error": str(e)
                })
            return

        if command.upper() == "BEDREADY":
            reference = None
            match_percentage = None
            parameters = parameters.split()
            if len(parameters) > 0:
                reference = parameters[0]
            if len(parameters) > 1:
                match_percentage = float(parameters[1])

            with self._printer.job_on_hold():
                try:
                    message = self.check_bed(reference, match_percentage, store_debug=True)
                    self._logger.debug("match: {}".format(message))
                    if not message.get("bed_clear"):
                        if self._settings.get_boolean(["cancel_print"]):
                            self._printer.cancel_print(tags={self._identifier})
                        else:
                            self._printer.pause_print(tags={self._identifier})
                    self._plugin_manager.send_plugin_message(self._identifier, message)
                except Exception as e:
                    self._logger.info(e)

    def check_bed(self, reference=None, match_percentage=None, store_debug=False, crop_coords=None):
        if reference == None:
            reference = self._settings.get(["reference_image"])

        # Normalize the reference image path for backwards compatibility
        reference = self.normalize_image_path(reference)

        if match_percentage == None:
            match_percentage = self._settings.get_float(["match_percentage"])

        self._logger.info(f"check_bed with reference {reference} (threshold {match_percentage})")
        try:
            self.take_snapshot(COMPARISON_FILENAME)
            similarity = self.compare_images(
                os.path.join(self.get_plugin_data_folder(), reference),
                os.path.join(self.get_plugin_data_folder(), COMPARISON_FILENAME),
                crop_coords=crop_coords)

            # Store debug image if requested (from @BEDREADY command, not manual test)
            if store_debug:
                comparison_path = os.path.join(self.get_plugin_data_folder(), COMPARISON_FILENAME)
                self.store_debug_image(comparison_path, similarity)
        except Exception as e:
            self._logger.exception("Error during snapshot comparison:")

        return {"bed_clear": similarity > match_percentage, "test_image": COMPARISON_FILENAME, "reference_image": reference, "similarity": round(similarity, 4)}

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
