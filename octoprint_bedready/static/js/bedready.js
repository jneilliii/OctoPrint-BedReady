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
        self.popup_options = {
            title: 'Bed Not Ready',
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

        self.snapshot_valid = ko.pureComputed(function(){
            return self.settingsViewModel.webcam_snapshotUrl().length > 0 && self.settingsViewModel.webcam_snapshotUrl().startsWith('http');
        });

        self.onDataUpdaterPluginMessage = function (plugin, data) {
            if (plugin !== 'bedready') {
                return;
            }

            if (data.hasOwnProperty('similarity') && !data.bed_clear) {
                const similarity_pct = (parseFloat(data.similarity) * 100).toFixed(2);
                const reference_url = 'plugin/bedready/images/' + data.reference_image;
                const test_url = 'plugin/bedready/images/' + data.test_image;
                self.popup_options.text = `<div class="row-fluid"><p>Match percentage calculated as <span class="label label-info">${similarity_pct}%</span>.</p><p>Print job has been paused, check the bed and then resume.</p>Reference:<p><img src="${reference_url}"></img></p>Test:<p><img src="${test_url}"></img></p></div>`;
                self.popup_options.type = 'error';
                self.popup_options.title = 'Bed Not Ready';
                if (self.popup === undefined) {
                    self.popup = PNotify.singleButtonNotify(self.popup_options);
                } else {
                    self.popup.update(self.popup_options);
                    if (self.popup.state === 'closed'){
                        self.popup.open();
                    }
                }
            } else if (self.popup !== undefined && data.bed_clear) {
                self.popup.remove();
                self.popup = undefined;
            } else if (data.hasOwnProperty('error')) {
                self.popup_options.text = 'There was an error: ' + data.error.error;
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
                self.reference_images.remove(filename);
                new PNotify({
                    title: 'Snapshot Deleted',
                    text: filename,
                    hide: true
                });
              })
              .fail(function(response) {
                new PNotify({
                    title: 'Bed Ready Error',
                    text: 'There was an error deleting the snapshot: ' + response.responseJSON.error,
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
                      text: 'There was an error saving the snapshot: ' + response.responseJSON.error,
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
                  text: 'Failed to load snapshots: ' + response.responseJSON.error,
                  hide: true
              });
            });
        }
        self.load_snapshots();

        self.test_snapshot = function () {
            self.taking_snapshot(true);
            OctoPrint.simpleApiCommand('bedready', 'check_bed', {reference: self.settingsViewModel.settings.plugins.bedready.reference_image()})
                .done(function (response) {
                    const similarity_pct = (parseFloat(response.similarity) * 100).toFixed(2);
                    const reference_url = 'plugin/bedready/images/' + response.reference_image;
                    const test_url = 'plugin/bedready/images/' + response.test_image;
                    self.popup_options.text = `<div class="row-fluid"><p>Match percentage calculated as <span class="label label-info">${similarity_pct}%</span>.</p>Reference:<p><img src="${reference_url}"></img></p>Test:<p><img src="${test_url}"></img></p></div>`;
                    if (parseFloat(response.similarity) < parseFloat(self.settingsViewModel.settings.plugins.bedready.match_percentage())) {
                        self.popup_options.type = 'error';
                    } else {
                        self.popup_options.type = 'success';
                    }

                    self.popup_options.title = 'Bed Ready Test';
                    if (self.popup === undefined) {
                        self.popup = PNotify.singleButtonNotify(self.popup_options);
                    } else {
                        self.popup.update(self.popup_options);
                        if (self.popup.state === 'closed') {
                            self.popup.open();
                        }
                    }
                    self.taking_snapshot(false);
                });
        };

        // Initialize the canvas dimensions based on the loaded image
        self.initializeCanvas = function() {
            var img = document.getElementById('reference-snapshot');
            var canvas = document.getElementById('overlay-canvas');
            canvas.width = img.clientWidth;
            canvas.height = img.clientHeight;
            self.drawROI();
            $(canvas).css('pointer-events', 'auto'); // Make sure canvas is interactive
        };

        // Observable array to manage points on the canvas
        self.roi_points = ko.observableArray([
            { x: ko.observable(50), y: ko.observable(50) },
            { x: ko.observable(50), y: ko.observable(150) },
            { x: ko.observable(250), y: ko.observable(150) },
            { x: ko.observable(250), y: ko.observable(50) }
        ]);

        self.add_roi_point = function(x, y) {            
            self.roi_points.push(
                { x: ko.observable(x), y: ko.observable(y) }
            );
            self.drawROI();
            console.log("Added new point: (%d, %d)", x, y);
        }

        self.rm_roi_point = function(x, y) {
            self.roi_points.remove({x: ko.observable(x), y: ko.observable(y)});
            self.drawROI();
        }

        // Draw the ROI boundary based on the defined points
        self.drawROI = function() {
            var canvas = document.getElementById('overlay-canvas');
            var ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.save();

            // Draw quadrilateral
            ctx.beginPath();
            ctx.rect(0, 0, canvas.width, canvas.height);
            self.roi_points().forEach(function(point, index) {
                ctx[index === 0 ? 'moveTo' : 'lineTo'](point.x(), point.y());
            });
            ctx.clip();
            ctx.strokeStyle = 'lightgreen';
            ctx.lineWidth = 3;
            ctx.stroke();

            // Block out non-ROI:
            ctx.fillStyle = "rgba(20,20,20,0.666)";
            ctx.fillRect(0,0, canvas.width, canvas.height);
            ctx.restore();
            
            // Draw quadrilateral corners
            ctx.fillStyle = "blue";
            self.roi_points().forEach(function(point, index) {
                ctx.fillRect(point.x()-3, point.y()-3, 6, 6);
            });
        };

        // Event handlers for mouse actions on the canvas
        self.mouseDown = function(data, event) {
            var canvas = document.getElementById('overlay-canvas');
            var rect = canvas.getBoundingClientRect();
            var mouseX = event.clientX - rect.left;
            var mouseY = event.clientY - rect.top;
            self.roi_points().forEach(function(point) {
                if (Math.abs(point.x() - mouseX) < 10 && Math.abs(point.y() - mouseY) < 10) {
                    self.selectedPoint = point;
                    if(event.ctrlKey) {
                        self.roi_points.remove(point);
                        self.drawROI();
                        console.log("Removing ROI point: (%d, %d)", point.x(), point.y());
                    }
                }
            });
            if (event.ctrlKey && self.selectedPoint == null) {
                self.add_roi_point(mouseX, mouseY);
                console.log("Added new point: (%d, %d)", mouseX, mouseY);
                console.log(self.roi_points);
            }
        };

        self.mouseMove = function(data, event) {
            if (self.selectedPoint) {
                var rect = event.target.getBoundingClientRect();
                var mouseX = event.clientX - rect.left;
                var mouseY = event.clientY - rect.top;
                self.selectedPoint.x(mouseX);
                self.selectedPoint.y(mouseY);
                self.drawROI();
            }
        };

        self.mouseUp = function(data, event) {
            self.selectedPoint = null;
        };
        
        self.toggle_enable_roi = function() {
            if(document.getElementById('image-enable_roi_cb').checked) {
                console.log("ROI Enabled!");
                self.initializeCanvas();
            }
        }
        self.onReferenceLoaded = function() {
            console.log("Loaded Reference Image!");
            self.initializeCanvas();            
        }

        document.getElementById('image-container').addEventListener('onresize', function(){
            console.log("IMG resize!");
            self.initializeCanvas();
        });

        // Auto initialize ROI canvas when reference image is loaded:
        var ref_snapshot_img = document.getElementById('reference-snapshot')
        ref_snapshot_img.addEventListener('load', self.onReferenceLoaded)
        if (ref_snapshot_img.complete) {
            self.onReferenceLoaded();
        }
    }

    OCTOPRINT_VIEWMODELS.push({
        construct: BedreadyViewModel,
        dependencies: ['settingsViewModel', 'controlViewModel'],
        elements: ['#settings_plugin_bedready']
    });
});
