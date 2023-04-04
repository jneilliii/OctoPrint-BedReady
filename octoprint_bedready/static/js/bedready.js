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
                self.popup_options.text = '<div class="row-fluid"><p>Match percentage calculated as <span class="label label-warning">' + (parseFloat(data.similarity) * 100).toFixed(2) + '%</span>.</p><p>Print job has been paused, check bed and then resume.</p><p><img src="/plugin/bedready/images/compare.jpg?' + Math.round(new Date().getTime() / 1000) + '"></p></div>';
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
            OctoPrint.simpleApiCommand('bedready', 'take_snapshot', {test: true, reference: self.settingsViewModel.settings.plugins.bedready.reference_image()})
                .done(function (response) {
                    if (response.hasOwnProperty('test_image')) {
                        self.popup_options.text = '<div class="row-fluid"><p>Match percentage calculated as <span class="label label-info">' + (parseFloat(response.similarity) * 100).toFixed(2) + '%</span>.</p><p><img src="' + response.test_image + '"></p></div>';
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
