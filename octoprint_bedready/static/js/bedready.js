/*
 * View model for OctoPrint-BedReady
 *
 * Author: jneilliii
 * License: AGPLv3
 */
$(function () {
    function BedreadyViewModel(parameters) {
        var self = this;

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

        self.onDataUpdaterPluginMessage = function (plugin, data) {
            if (plugin !== 'bedready') {
                return;
            }
            if (data.hasOwnProperty('similarity')) {
                self.popup_options.text = '<div class="row-fluid"><p>Match percentage calculated as <span class="label label-warning">' + (parseFloat(data.similarity) * 100).toFixed(2) + '%</span>.</p><p>Print job has been paused, check bed and then resume.</p><p><img src="/plugin/bedready/images/compare.jpg?' + Math.round(new Date().getTime() / 1000) + '"></p></div>';
                if (self.popup === undefined) {
                    self.popup = PNotify.singleButtonNotify(self.popup_options);
                } else {
                    self.popup.update(self.popup_options);
                }
            } else if (self.popup !== undefined && data.bed_clear) {
                self.popup.remove();
                self.popup = undefined;
            }
        };

        self.take_snapshot = function () {
            self.taking_snapshot(true);
            OctoPrint.simpleApiCommand('bedready', 'take_snapshot')
                .done(function (response) {
                    if (response.hasOwnProperty('reference_image')) {
                        self.settingsViewModel.settings.plugins.bedready.reference_image(response.reference_image);
                        self.settingsViewModel.settings.plugins.bedready.reference_image_timestamp(response.reference_image_timestamp);
                    } else {
                        new PNotify({
                            title: 'Bed Ready Error',
                            text: '<div class="row-fluid"><p>There was an error saving the reference snapshot.</p></div><p><pre style="padding-top: 5px;">' + response.error + '</pre></p>',
                            hide: true
                        });
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
