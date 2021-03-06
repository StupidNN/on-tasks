// Copyright 2017, Dell EMC, Inc.

'use strict';

var di = require('di');

module.exports = diagUpdateFirmwareFactory;
di.annotate(diagUpdateFirmwareFactory, new di.Provide('Job.Emc.Diag.Update.Firmware'));
di.annotate(diagUpdateFirmwareFactory, new di.Inject(
    'Job.Base',
    'JobUtils.DiagTool',
    'Logger',
    'Util',
    'Assert',
    'Promise',
    '_'
));

function diagUpdateFirmwareFactory(
    BaseJob,
    DiagTool,
    Logger,
    util,
    assert,
    Promise,
    _
) {
    var logger = Logger.initialize(diagUpdateFirmwareFactory);
    function DiagUpdateFirmware(options, context, taskId) {
        DiagUpdateFirmware.super_.call(this, logger, options, context, taskId);

        this.nodeId = this.context.target;
        this.imageUrl = options.imageUrl;
        this.imageName = options.imageName;
        this.imageMode = options.imageMode;
        this.firmwareType = options.firmwareType;
        this.skipReset = options.skipReset || false;
        this.diagImagePath = '/uploads';
        this.spiModeMapping = {
            'fullbios': '0',
            'bios': '1',
            'uefi': '2',
            'serdes': '3',
            'post': '4',
            'me': '5'
        };
        this.bmcModeMapping = {
            'ssp': '0x142',
            'bmcapp': '0x140',
            'bootblock': '0x144',
            'adaptivecooling': '0x145',
            'fullbmc': '0x5f'
        };
        this.diagTool = {};
        this.retryCount = 6;
        this.retryDuration = 5000; // in milliseconds
    }
    util.inherits(DiagUpdateFirmware, BaseJob);

    /**
     * @memberOf DiagUpdateFirmware
     */
    DiagUpdateFirmware.prototype._run = function() {
        var self = this;

        return Promise.try(function(){
            var settings = {host: self.getNodeIp()};
            self.diagTool = new DiagTool(settings, self.nodeId);
            return self.diagTool.retrySyncDiscovery(self.retryDuration, self.retryCount);
        })
        .then(function(){
            return self.diagTool.getAllDevices();
        })
        .then(function(){
            return self.diagTool.uploadImageFile(self.imageUrl, self.imageName, '/api/upload/file');
        })
        .then(function(){
            var method = 'update' + _.capitalize(self.firmwareType);
            return self[method](self.imageName, self.imageMode, self.diagImagePath);
        })
        .then(function(){
            self._done();
        })
        .catch(function(err){
            self._done(err);
        });
    };

    /**
    * Get node IP from context
    * @return {String} IP address string
    */
    DiagUpdateFirmware.prototype.getNodeIp = function(){
        var ip = this.context.nodeIp;
        assert.isIP(ip, 4);
        return ip;
    };

    /**
    * Parse image mode for bios firmware update
    * @param {String/Integer} mode: user selected image mode, mapping as below:
    *   '0'/0/'fullbios' - full BIOS,
    *   '1'/1/'bios' - BIOS,
    *   '2'/2/'uefi' - UEFI,
    *   '3'/3/'serdes' - serdes,
    *   '4'/4/'post' - POST,
    *   '5'/5/'me' - ME
    * @return {String} mode string, a value of '0' - '5'
    */
    DiagUpdateFirmware.prototype.parseSpiMode = function(mode){
        var self = this;
        var _mode = parseInt(mode);
        if (_.isNaN(_mode)){
            _mode = self.spiModeMapping[mode];
        } else {
            _mode = _(mode).toString();
        }
        return _mode;
    };

    /**
    * Parse image mode for bmc firmware update
    * @param {String} mode: user selected image mode, mapping as below:
    *   '0x142'/'ssp' - SSP,
    *   '0x140'/'bmcapp' - BMC Main APP,
    *   '0x144'/'bootblock' - Bootblock,
    *   '0x145'/'adaptivecooling' - Adaptive Cooling,
    *   '0x5f'/'fullbmc' - BMC full image
    * @return {String} mode string, a hex number.
    */
    DiagUpdateFirmware.prototype.parseBmcMode = function(mode){
        var self = this;
        if (!_.startsWith(mode, '0x')){
            mode = self.bmcModeMapping[mode];
        }
        return mode;
    };

    /**
    * Update bmc firmware
    * @param {String} imageName: image name
    * @param {String} mode: image mode
    * @param {String} diagImagePath: image file path in diag system
    * @return {Promise}
    */
    DiagUpdateFirmware.prototype.updateBmc = function(imageName, imageMode, diagImagePath){
        var self = this;
        var _imageMode = self.parseBmcMode(imageMode);
        assert.isIn(_imageMode, ['0x142', '0x140', '0x144', '0x145', '0x5f']);
        return self.diagTool.updateFirmware('bmc', imageName, _imageMode, diagImagePath)
        .then(function(){
            // TODO: this reset is required to be validated after diag is ready
            // It may vary with SSP/BMC update
            if (!self.skipReset){
                return self.diagTool.bmcReset(false);
            }
        });
    };

    /**
    * Update bios/spirom firmware
    * @param {String} imageName: image name
    * @param {String} mode: image mode
    * @param {String} diagImagePath: image file path in diag system
    * @return {Promise}
    */
    DiagUpdateFirmware.prototype.updateSpi = function(imageName, imageMode, diagImagePath){
        var self = this;
        var _imageMode = self.parseSpiMode(imageMode);
        assert.isIn(_imageMode, ['0', '1', '2', '3', '4', '5']);
        return self.diagTool.updateFirmware('spi', imageName, _imageMode, diagImagePath)
        .then(function(body){
            var resetFlag;
            var error;
            var parseFailed;
            try {
                // Reset prompt is used as indication of update SPIROM API executing success.
                resetFlag = body.result[body.result.length-2].atomic_test_data.secure_firmware_update;
            } catch(err) {
                error = err;
            }
            parseFailed = !_.isEqual(resetFlag, 'Issue warm reset NOW!') || error;
            if(parseFailed){
                logger.error('Failed to get reset flags from diag', {
                    error: error,
                    body: body,
                    nodeId: self.nodeId
                });
                throw new Error('Failed to get reset flags from diag');
            }
        })
        .then(function(){
            if (!self.skipReset){
                return self.diagTool.warmReset(false);
            }
        });
    };

    return DiagUpdateFirmware;
}
