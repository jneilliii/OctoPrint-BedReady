/*
 * View model for OctoPrint-BedReady
 *
 * Author: jneilliii
 * License: AGPLv3
 */
$(function () {
    function BedreadyViewModel(parameters) {
        var self = this;

        self.reference_images = ko.observableArray([]);
        self.taking_snapshot = ko.observable(false);
        self.debug_images = ko.observableArray([]);
        self.selected_debug_image = ko.observable(null);
        self.popup_options = {
            title: 'Bed Ready Plugin',
            text: '',
            hide: false,
            type: 'error',
            addclass: 'bedready_notice',
            buttons: {
                sticker: false
            }
        };

        self.settingsViewModel = parameters[0];
        self.controlViewModel = parameters[1];
        self.timelapseViewModel = parameters[2];

        self.get_image_url = function(data) {
            if(typeof(data) === 'undefined') {
                if (self.settingsViewModel.settings.plugins.bedready.reference_image() === "") {
                    return '';
                } else {
                    return 'plugin/bedready/images/' + self.settingsViewModel.settings.plugins.bedready.reference_image();
                }
            } else {
                return 'plugin/bedready/images/' + data;
            }
        };

        // Crop editor variables
        self.canvas = null;
        self.ctx = null;
        self.img = null;
        self.isDragging = false;
        self.draggedCorner = null;
        self.scale = 1;
        self.imageWidth = 0;
        self.imageHeight = 0;
        self.handleSize = 12;

        // Store event handler references for cleanup
        self.canvasMouseDownHandler = null;
        self.canvasMouseMoveHandler = null;
        self.canvasMouseUpHandler = null;
        self.canvasMouseLeaveHandler = null;

        self.snapshot_status_valid = ko.observable(false);

        self.snapshot_valid = ko.pureComputed(function(){
            return self.timelapseViewModel.canSnapshot();
        });

        self.show_similarity = function(data, title) {
            const similarity_pct = (parseFloat(data.similarity) * 100).toFixed(2);
            const timestamp = new Date().getTime();
            // Use unique image urls to prevent issues with browser caching
            const reference_url = self.get_image_url(data.reference_image) + '?t=' + timestamp;
            const test_url = self.get_image_url(data.test_image) + '?t=' + timestamp;
            if(!data.bed_clear) {
                self.popup_options.text = `<div class="row-fluid"><p>Match percentage calculated as <span class="label label-info">${similarity_pct}%</span>.</p><p>Print job has been paused, check the bed and then resume.</p>Reference:<p><img src="${reference_url}"></img></p>Test:<p><img src="${test_url}"></img></p></div>`;
            } else {
                self.popup_options.text = `<div class="row-fluid"><p>Match percentage calculated as <span class="label label-info">${similarity_pct}%</span>.</p>Reference:<p><img src="${reference_url}"></img></p>Test:<p><img src="${test_url}"></img></p></div>`;
            }
            if (parseFloat(data.similarity) < parseFloat(self.settingsViewModel.settings.plugins.bedready.match_percentage())) {
                self.popup_options.type = 'error';
            } else {
                self.popup_options.type = 'success';
            }
            if(title) {
                self.popup_options.title = title;
            } else {
                self.popup_options.title = 'Bed Not Ready';
            }

            if (self.popup === undefined) {
                self.popup = PNotify.singleButtonNotify(self.popup_options);
            } else {
                self.popup.update(self.popup_options);
                if (self.popup.state === 'closed'){
                    self.popup.open();
                }
            }
        };

        self.onDataUpdaterPluginMessage = function (plugin, data) {
            if (plugin !== 'bedready') {
                return;
            }

            if (data.hasOwnProperty('similarity') && !data.bed_clear) {
                data["title"] = 'Bed Ready Test';
                self.show_similarity(data);

                // Reload debug images if debug mode is enabled
                if (self.settingsViewModel.settings.plugins.bedready.debug_mode()) {
                    self.load_debug_images();
                }
            } else if (self.popup !== undefined && data.bed_clear) {
                self.popup.remove();
                self.popup = undefined;
                // Reload debug images if debug mode is enabled
                if (self.settingsViewModel.settings.plugins.bedready.debug_mode()) {
                    self.load_debug_images();
                }
            } else if (data.hasOwnProperty('error')) {
                self.popup_options.text = 'There was an error: ' + _.escape(data.error.error);
                self.popup_options.type = 'error';
                self.popup_options.title = 'Bed Ready Error';
                if (self.popup === undefined) {
                    self.popup = PNotify.singleButtonNotify(self.popup_options);
                } else {
                    self.popup.update(self.popup_options);
                    if (self.popup.state === 'closed'){
                        self.popup.open();
                    }
                }
            }
        };

        self.delete_snapshot = function(filename) {
          OctoPrint.simpleApiCommand('bedready', 'delete_snapshot', {filename})
              .done(function (response) {
                self.reference_images(response);
                new PNotify({
                    title: 'Snapshot Deleted',
                    text: filename,
                    hide: true
                });
              })
              .fail(function(response) {
                new PNotify({
                    title: 'Bed Ready Error',
                    text: 'There was an error deleting the snapshot: ' + _.escape(response.responseJSON.error),
                    hide: true
                });
              });
        }

        self.set_default_snapshot = function(filename) {
          self.settingsViewModel.settings.plugins.bedready.reference_image(filename);
        }

        self.take_snapshot = function() {
            self.taking_snapshot(true);
            OctoPrint.simpleApiCommand('bedready', 'take_snapshot', {name: "reference_" + (new Date()).toISOString() + ".jpg"})
                .done(function (response) {
                  self.reference_images(response);
                  self.taking_snapshot(false);
                })
                .fail(function (response) {
                  new PNotify({
                      title: 'Bed Ready Error',
                      text: 'There was an error saving the snapshot: ' + _.escape(response.responseJSON.error),
                      hide: true
                  });
                  self.taking_snapshot(false);
                });
        };

        self.load_snapshots = function() {
          OctoPrint.simpleApiCommand('bedready', 'list_snapshots')
            .done(function (response) {
              self.reference_images(response);
            })
            .fail(function (response) {
              new PNotify({
                  title: 'Bed Ready Error',
                  text: 'Failed to load snapshots: ' + _.escape(response.responseJSON.error),
                  hide: true
              });
            });
        }
        self.load_snapshots();

        // Debug images functions
        self.load_debug_images = function() {
          OctoPrint.simpleApiCommand('bedready', 'list_debug_images')
            .done(function (response) {
              self.debug_images(response);
            })
            .fail(function (response) {
              console.error('Failed to load debug images:', response);
            });
        };

        self.show_debug_image = function(debug_image) {
          self.selected_debug_image(debug_image);
          $('#bedready_debug_modal').modal('show');
        };

        self.delete_debug_image = function(debug_image) {
          if (!confirm('Delete this debug image?')) {
            return;
          }
          OctoPrint.simpleApiCommand('bedready', 'delete_debug_image', {filename: debug_image.filename})
            .done(function (response) {
              self.debug_images(response);
              new PNotify({
                  title: 'Debug Image Deleted',
                  text: debug_image.filename,
                  hide: true,
                  type: 'success'
              });
            })
            .fail(function (response) {
              var errorMessage = 'Unknown error';
              if (response) {
                if (response.responseJSON && response.responseJSON.error) {
                  errorMessage = response.responseJSON.error;
                } else if (response.error) {
                  errorMessage = response.error;
                } else if (response.statusText) {
                  errorMessage = response.statusText;
                }
              }
              new PNotify({
                  title: 'Bed Ready Error',
                  text: 'There was an error deleting the debug image: ' + _.escape(errorMessage),
                  hide: true,
                  type: 'error'
              });
            });
        };

        // Load debug images when settings are shown
        self.onSettingsShown = function() {
            self.load_debug_images();
        };

        // Crop editor functions
        self.imageLoaded = function() {
            self.img = document.getElementById('bedready-reference-image');
            self.canvas = document.getElementById('bedready-crop-canvas');
            if (!self.canvas || !self.img) return;

            self.ctx = self.canvas.getContext('2d');

            // Remove old event listeners if they exist
            if (self.canvasMouseDownHandler) {
                self.canvas.removeEventListener('mousedown', self.canvasMouseDownHandler);
                self.canvas.removeEventListener('mousemove', self.canvasMouseMoveHandler);
                self.canvas.removeEventListener('mouseup', self.canvasMouseUpHandler);
                self.canvas.removeEventListener('mouseleave', self.canvasMouseLeaveHandler);
            }

            // Create and store event handler functions
            self.canvasMouseDownHandler = function(e) {
                self.startCrop(null, e);
            };
            self.canvasMouseMoveHandler = function(e) {
                self.moveCrop(null, e);
            };
            self.canvasMouseUpHandler = function(e) {
                self.endCrop(null, e);
            };
            self.canvasMouseLeaveHandler = function(e) {
                self.cancelCrop(null, e);
            };

            // Add new event listeners
            self.canvas.addEventListener('mousedown', self.canvasMouseDownHandler);
            self.canvas.addEventListener('mousemove', self.canvasMouseMoveHandler);
            self.canvas.addEventListener('mouseup', self.canvasMouseUpHandler);
            self.canvas.addEventListener('mouseleave', self.canvasMouseLeaveHandler);

            // Get actual image dimensions
            OctoPrint.simpleApiCommand('bedready', 'get_image_dimensions', {
                filename: self.settingsViewModel.settings.plugins.bedready.reference_image()
            }).done(function(response) {
                self.imageWidth = response.width;
                self.imageHeight = response.height;

                // Initialize crop coordinates if not set (create rectangle covering full image)
                var bedreadySettings = self.settingsViewModel.settings.plugins.bedready;
                var currentCropValues = [
                    bedreadySettings.crop_x1(), bedreadySettings.crop_y1(),
                    bedreadySettings.crop_x2(), bedreadySettings.crop_y2(),
                    bedreadySettings.crop_x3(), bedreadySettings.crop_y3(),
                    bedreadySettings.crop_x4(), bedreadySettings.crop_y4()
                ].map(function(value) {
                    return parseInt(value, 10);
                });
                var allCropValuesUnset = currentCropValues.every(function(value) {
                    return isNaN(value) || value === 0;
                });
                if (allCropValuesUnset) {
                    // Top-left
                    bedreadySettings.crop_x1(0);
                    bedreadySettings.crop_y1(0);
                    // Top-right
                    bedreadySettings.crop_x2(self.imageWidth);
                    bedreadySettings.crop_y2(0);
                    // Bottom-right
                    bedreadySettings.crop_x3(self.imageWidth);
                    bedreadySettings.crop_y3(self.imageHeight);
                    // Bottom-left
                    bedreadySettings.crop_x4(0);
                    bedreadySettings.crop_y4(self.imageHeight);
                }

                self.drawCanvas();
            }).fail(function(jqXHR, status, error) {
                // Handle failure to retrieve image dimensions gracefully
                console.error('Failed to get image dimensions for BedReady reference image:', status, error);
                self.popup_options.text = 'Unable to load reference image dimensions. The crop editor may not function correctly. Please verify the reference image file.';
                try {
                    new PNotify(self.popup_options);
                } catch (e) {
                    // Fallback if PNotify is not available
                    alert(self.popup_options.text);
                }
            });
        };

        self.getCorners = function() {
            return [
                {x: parseInt(self.settingsViewModel.settings.plugins.bedready.crop_x1()) || 0,
                 y: parseInt(self.settingsViewModel.settings.plugins.bedready.crop_y1()) || 0},
                {x: parseInt(self.settingsViewModel.settings.plugins.bedready.crop_x2()) || 0,
                 y: parseInt(self.settingsViewModel.settings.plugins.bedready.crop_y2()) || 0},
                {x: parseInt(self.settingsViewModel.settings.plugins.bedready.crop_x3()) || 0,
                 y: parseInt(self.settingsViewModel.settings.plugins.bedready.crop_y3()) || 0},
                {x: parseInt(self.settingsViewModel.settings.plugins.bedready.crop_x4()) || 0,
                 y: parseInt(self.settingsViewModel.settings.plugins.bedready.crop_y4()) || 0}
            ];
        };

        self.setCorners = function(corners) {
            self.settingsViewModel.settings.plugins.bedready.crop_x1(corners[0].x);
            self.settingsViewModel.settings.plugins.bedready.crop_y1(corners[0].y);
            self.settingsViewModel.settings.plugins.bedready.crop_x2(corners[1].x);
            self.settingsViewModel.settings.plugins.bedready.crop_y2(corners[1].y);
            self.settingsViewModel.settings.plugins.bedready.crop_x3(corners[2].x);
            self.settingsViewModel.settings.plugins.bedready.crop_y3(corners[2].y);
            self.settingsViewModel.settings.plugins.bedready.crop_x4(corners[3].x);
            self.settingsViewModel.settings.plugins.bedready.crop_y4(corners[3].y);
        };

        self.normalizeCropCorners = function(corners) {
            // Use convex hull to keep an outer, non-crossing polygon in all perspective cases.
            const pts = corners.slice().sort(function(a, b) {
                if (a.x === b.x) {
                    return a.y - b.y;
                }
                return a.x - b.x;
            });

            function cross(o, a, b) {
                return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
            }

            const lower = [];
            pts.forEach(function(p) {
                while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
                    lower.pop();
                }
                lower.push(p);
            });

            const upper = [];
            for (let i = pts.length - 1; i >= 0; i--) {
                const p = pts[i];
                while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
                    upper.pop();
                }
                upper.push(p);
            }

            const hull = lower.slice(0, -1).concat(upper.slice(0, -1));

            // With 4 outer points this guarantees a simple non-crossing order.
            if (hull.length === 4) {
                return hull;
            }

            // Fallback for degenerate cases: keep a deterministic, stable cyclic order.
            const centroid = corners.reduce(function(acc, p) {
                return {x: acc.x + p.x / 4, y: acc.y + p.y / 4};
            }, {x: 0, y: 0});

            return corners.slice().sort(function(a, b) {
                return Math.atan2(a.y - centroid.y, a.x - centroid.x) - Math.atan2(b.y - centroid.y, b.x - centroid.x);
            });
        };

        self.drawCanvas = function() {
            if (!self.canvas || !self.img || !self.ctx) return;

            // Ensure image dimensions are loaded and valid
            if (self.imageWidth <= 0 || self.imageHeight <= 0) return;

            // Set canvas size to fit container (max 800px wide)
            const maxWidth = 800;
            self.scale = Math.min(1, maxWidth / self.imageWidth);
            self.canvas.width = self.imageWidth * self.scale;
            self.canvas.height = self.imageHeight * self.scale;

            // Draw image
            self.ctx.drawImage(self.img, 0, 0, self.canvas.width, self.canvas.height);

            // Get corners in scaled coordinates
            const corners = self.getCorners();
            const scaledCorners = corners.map(c => ({x: c.x * self.scale, y: c.y * self.scale}));

            // Draw dimmed overlay outside the quadrilateral
            self.ctx.save();
            self.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';

            // Create clipping path for the area outside the quadrilateral
            self.ctx.beginPath();
            self.ctx.rect(0, 0, self.canvas.width, self.canvas.height);
            self.ctx.moveTo(scaledCorners[0].x, scaledCorners[0].y);
            for (let i = 1; i < scaledCorners.length; i++) {
                self.ctx.lineTo(scaledCorners[i].x, scaledCorners[i].y);
            }
            self.ctx.closePath();
            self.ctx.fill('evenodd');
            self.ctx.restore();

            // Draw quadrilateral border
            self.ctx.strokeStyle = '#00ff00';
            self.ctx.lineWidth = 2;
            self.ctx.beginPath();
            self.ctx.moveTo(scaledCorners[0].x, scaledCorners[0].y);
            for (let i = 1; i < scaledCorners.length; i++) {
                self.ctx.lineTo(scaledCorners[i].x, scaledCorners[i].y);
            }
            self.ctx.closePath();
            self.ctx.stroke();

            // Draw corner handles
            self.ctx.fillStyle = '#00ff00';
            scaledCorners.forEach((corner, idx) => {
                self.ctx.fillRect(
                    corner.x - self.handleSize/2,
                    corner.y - self.handleSize/2,
                    self.handleSize,
                    self.handleSize
                );

                // Draw corner number
                self.ctx.fillStyle = '#fff';
                self.ctx.font = '12px Arial';
                self.ctx.fillText((idx + 1).toString(), corner.x + 10, corner.y - 10);
                self.ctx.fillStyle = '#00ff00';
            });
        };

        self.findCornerAtPosition = function(x, y) {
            const corners = self.getCorners();
            const threshold = self.handleSize * 2; // Larger threshold for easier selection

            for (let i = 0; i < corners.length; i++) {
                // Convert corner position to canvas coordinates
                const cornerX = corners[i].x * self.scale;
                const cornerY = corners[i].y * self.scale;
                const dx = cornerX - x;
                const dy = cornerY - y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                if (distance < threshold) {
                    return i;
                }
            }
            return null;
        };

        self.startCrop = function(data, event) {
            if (!self.canvas) return true;

            const rect = self.canvas.getBoundingClientRect();
            // Account for any scaling of the canvas element itself
            const scaleX = self.canvas.width / rect.width;
            const scaleY = self.canvas.height / rect.height;
            const canvasX = (event.clientX - rect.left) * scaleX;
            const canvasY = (event.clientY - rect.top) * scaleY;

            self.draggedCorner = self.findCornerAtPosition(canvasX, canvasY);
            if (self.draggedCorner !== null) {
                self.isDragging = true;
                event.preventDefault();
                return false;
            }
            return true;
        };

        self.moveCrop = function(data, event) {
            if (!self.canvas) return true;

            const rect = self.canvas.getBoundingClientRect();
            // Account for any scaling of the canvas element itself
            const scaleX = self.canvas.width / rect.width;
            const scaleY = self.canvas.height / rect.height;
            const canvasX = (event.clientX - rect.left) * scaleX;
            const canvasY = (event.clientY - rect.top) * scaleY;

            if (!self.isDragging || self.draggedCorner === null) {
                // Update cursor style based on hover
                const hoveredCorner = self.findCornerAtPosition(canvasX, canvasY);
                self.canvas.style.cursor = hoveredCorner !== null ? 'move' : 'crosshair';
                return true;
            }

            // Convert canvas coordinates to image coordinates
            const imageX = canvasX / self.scale;
            const imageY = canvasY / self.scale;

            // Clamp to image boundaries
            const x = Math.max(0, Math.min(self.imageWidth, Math.round(imageX)));
            const y = Math.max(0, Math.min(self.imageHeight, Math.round(imageY)));

            // Update dragged corner, then normalize so corners remain non-crossing.
            const corners = self.getCorners();
            corners[self.draggedCorner] = {x: x, y: y};
            const normalizedCorners = self.normalizeCropCorners(corners);

            // Keep dragging the same physical point after normalization/reindexing.
            let closestIdx = 0;
            let minDistance = Number.POSITIVE_INFINITY;
            normalizedCorners.forEach(function(corner, idx) {
                const dx = corner.x - x;
                const dy = corner.y - y;
                const distance = (dx * dx) + (dy * dy);
                if (distance < minDistance) {
                    minDistance = distance;
                    closestIdx = idx;
                }
            });
            self.draggedCorner = closestIdx;
            self.setCorners(normalizedCorners);

            self.drawCanvas();
            event.preventDefault();
            return false;
        };

        self.endCrop = function(data, event) {
            if (self.isDragging) {
                self.isDragging = false;
                self.draggedCorner = null;
                event.preventDefault();
                return false;
            }
            return true;
        };

        self.cancelCrop = function(data, event) {
            if (self.isDragging) {
                self.isDragging = false;
                self.draggedCorner = null;
                event.preventDefault();
                return false;
            }
            return true;
        };

        self.updateCropFromInputs = function() {
            // Only update if image dimensions are available
            if (!self.imageWidth || !self.imageHeight) {
                return;
            }

            // Validate and constrain values
            const rawX1 = parseInt(self.settingsViewModel.settings.plugins.bedready.crop_x1());
            const rawY1 = parseInt(self.settingsViewModel.settings.plugins.bedready.crop_y1());
            const rawX2 = parseInt(self.settingsViewModel.settings.plugins.bedready.crop_x2());
            const rawY2 = parseInt(self.settingsViewModel.settings.plugins.bedready.crop_y2());
            const rawX3 = parseInt(self.settingsViewModel.settings.plugins.bedready.crop_x3());
            const rawY3 = parseInt(self.settingsViewModel.settings.plugins.bedready.crop_y3());
            const rawX4 = parseInt(self.settingsViewModel.settings.plugins.bedready.crop_x4());
            const rawY4 = parseInt(self.settingsViewModel.settings.plugins.bedready.crop_y4());
            const x1 = Math.max(0, Math.min(self.imageWidth, isNaN(rawX1) ? 0 : rawX1));
            const y1 = Math.max(0, Math.min(self.imageHeight, isNaN(rawY1) ? 0 : rawY1));
            const x2 = Math.max(0, Math.min(self.imageWidth, isNaN(rawX2) ? 0 : rawX2));
            const y2 = Math.max(0, Math.min(self.imageHeight, isNaN(rawY2) ? 0 : rawY2));
            const x3 = Math.max(0, Math.min(self.imageWidth, isNaN(rawX3) ? 0 : rawX3));
            const y3 = Math.max(0, Math.min(self.imageHeight, isNaN(rawY3) ? 0 : rawY3));
            const x4 = Math.max(0, Math.min(self.imageWidth, isNaN(rawX4) ? 0 : rawX4));
            const y4 = Math.max(0, Math.min(self.imageHeight, isNaN(rawY4) ? 0 : rawY4));

            const normalizedCorners = self.normalizeCropCorners([
                {x: x1, y: y1},
                {x: x2, y: y2},
                {x: x3, y: y3},
                {x: x4, y: y4}
            ]);
            self.setCorners(normalizedCorners);

            self.drawCanvas();
        };

        self.resetCrop = function() {
            // Top-left
            self.settingsViewModel.settings.plugins.bedready.crop_x1(0);
            self.settingsViewModel.settings.plugins.bedready.crop_y1(0);
            // Top-right
            self.settingsViewModel.settings.plugins.bedready.crop_x2(self.imageWidth);
            self.settingsViewModel.settings.plugins.bedready.crop_y2(0);
            // Bottom-right
            self.settingsViewModel.settings.plugins.bedready.crop_x3(self.imageWidth);
            self.settingsViewModel.settings.plugins.bedready.crop_y3(self.imageHeight);
            // Bottom-left
            self.settingsViewModel.settings.plugins.bedready.crop_x4(0);
            self.settingsViewModel.settings.plugins.bedready.crop_y4(self.imageHeight);
            self.drawCanvas();
        };

        self.test_snapshot = function () {
            self.taking_snapshot(true);
            OctoPrint.simpleApiCommand('bedready', 'check_bed', {
                reference: self.settingsViewModel.settings.plugins.bedready.reference_image(),
                crop_x1: self.settingsViewModel.settings.plugins.bedready.crop_x1(),
                crop_y1: self.settingsViewModel.settings.plugins.bedready.crop_y1(),
                crop_x2: self.settingsViewModel.settings.plugins.bedready.crop_x2(),
                crop_y2: self.settingsViewModel.settings.plugins.bedready.crop_y2(),
                crop_x3: self.settingsViewModel.settings.plugins.bedready.crop_x3(),
                crop_y3: self.settingsViewModel.settings.plugins.bedready.crop_y3(),
                crop_x4: self.settingsViewModel.settings.plugins.bedready.crop_x4(),
                crop_y4: self.settingsViewModel.settings.plugins.bedready.crop_y4()
            })
                .done(function (response) {
                    self.show_similarity(response, 'Bed Ready Test');
                    self.taking_snapshot(false);
                });
        };
    }

    OCTOPRINT_VIEWMODELS.push({
        construct: BedreadyViewModel,
        dependencies: ['settingsViewModel', 'controlViewModel', 'timelapseViewModel'],
        elements: ['#settings_plugin_bedready']
    });
});
