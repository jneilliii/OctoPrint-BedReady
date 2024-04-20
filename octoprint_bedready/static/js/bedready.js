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
        self.lasso_enabled = false;

        self.settingsViewModel = parameters[0];
        self.controlViewModel = parameters[1];

        self.snapshot_valid = ko.pureComputed(function(){
            return self.settingsViewModel.webcam_snapshotUrl().length > 0 && self.settingsViewModel.webcam_snapshotUrl().startsWith('http');
        });

        self.onAllBound = function(data) {
			self.settingsViewModel.settings.plugins.bedready.enable_mask.subscribe(function(newValue){
				self.toggle_lasso();
			});

            self.toggle_lasso();
        };

        self.toggle_lasso = function() {
            if (!self.lasso_enabled && self.settingsViewModel.settings.plugins.bedready.enable_mask()) {
                self.lasso = createLasso({
                    element: document.querySelector('img#reference_image'),
                    radius: 10,
                    onChange(polygon) {
                        let mask_points = polygon.split(" ");
                        let floored_points = [];
                        for (let i = 0; i < mask_points.length; i++) {
                            let coords = mask_points[i].split(',').map(Math.round);
                            floored_points.push(coords.join(","));
                        }
                        self.settingsViewModel.settings.plugins.bedready.mask_points(floored_points.join(" "));
                    }
                });

                self.lasso.setPath(self.settingsViewModel.settings.plugins.bedready.mask_points());
                self.lasso_enabled = true;
            } else if (!self.settingsViewModel.settings.plugins.bedready.enable_mask()) {
                $('#settings_plugin_bedready_form canvas').replaceWith('<img src="plugin/bedready/images/'+self.settingsViewModel.settings.plugins.bedready.reference_image()+'" id="reference_image" alt="bed snapshot">');
                self.lasso_enabled = false;
                console.log("mask disabled");
            } else {
                console.log("mask already enabled");
            }
        };

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

        self.update_mask_points = function(img, data) {
            console.log(data);
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
            OctoPrint.simpleApiCommand('bedready', 'take_snapshot', {name: "reference_" + (new Date()).toISOString() + ".jpg", enable_mask: self.settingsViewModel.settings.plugins.bedready.enable_mask(), mask_points: self.settingsViewModel.settings.plugins.bedready.mask_points()})
                .done(function (response) {
					if (response.hasOwnProperty('error')) {
						self.popup_options.text = 'There was an error: \n<pre>' + response.error + '</pre>';
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
					} else {
						self.reference_images(response);
					}
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
            OctoPrint.simpleApiCommand('bedready', 'check_bed', {reference: self.settingsViewModel.settings.plugins.bedready.reference_image(), enable_mask: self.settingsViewModel.settings.plugins.bedready.enable_mask(), mask_points: self.settingsViewModel.settings.plugins.bedready.mask_points()})
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
    }

    OCTOPRINT_VIEWMODELS.push({
        construct: BedreadyViewModel,
        dependencies: ['settingsViewModel', 'controlViewModel'],
        elements: ['#settings_plugin_bedready']
    });
});
