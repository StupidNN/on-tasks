// Copyright 2015, Renasar Technologies Inc.
/* jshint node:true */

'use strict';

describe('ISC DHCP Poller Job', function () {
    var base = require('./base-spec');
    var uuid;

    var leaseData = new Buffer(
        "# The format of this file is documented in the dhcpd.leases(5) manual page.\n" +
        "# This lease file was written by isc-dhcp-4.3.2\n" +
        "\n\n" +
        "lease 10.1.1.3 {\n" +
        "  starts 1 2015/04/20 21:14:52;\n" +
        "  ends 1 2015/04/20 21:24:52;\n" +
        "  cltt 1 2015/04/20 21:14:52;\n" +
        "  binding state active;\n" +
        "  next binding state free;\n" +
        "  rewind binding state free;\n" +
        "  hardware ethernet 08:00:27:9b:d9:f8;\n" +
        "  set vendor-class-identifier = \"PXEClient:Arch:00000:UNDI:002001\";\n" +
        "}\n"
    );

    base.before('ISC DHCP Poller Job before', function (context) {
        // create a child injector with on-core and the base pieces we need to test this
        helper.setupInjector([
            helper.require('/spec/mocks/logger.js'),
            helper.require('/lib/jobs/base-job.js'),
            helper.require('/lib/jobs/isc-dhcp-lease-poller.js')
        ]);

        uuid = helper.injector.get('uuid');

        context.Jobclass = helper.injector.get('Job.IscDhcpLeasePoller');
    });

    describe('Base', function () {
        base.examples();
    });

    describe('Platform', function() {
        var platform;

        before('ISC DHCP Poller Job platform before', function() {
            platform = process.platform;
        });

        beforeEach('ISC DHCP Poller Job platform beforeEach', function() {
            process.platform = null;
        });

        after('ISC DHCP Poller Job platform before', function() {
            process.platform = platform;
        });

        it('should find the right lease file on linux', function() {
            process.platform = 'linux';
            var _job = new this.Jobclass({}, {}, uuid.v4());
            expect(_job.options.leasesFile).to.equal('/var/lib/dhcp/dhcpd.leases');
        });

        it('should find the right lease file on OSX', function() {
            process.platform = 'darwin';
            var _job = new this.Jobclass({}, {}, uuid.v4());
            expect(_job.options.leasesFile).to.equal('/var/db/dhcpd.leases');
        });

        it('should throw on unsupported platform', function() {
            var self = this;
            process.platform = 'invalid';
            expect(function() {
                var _job = new self.Jobclass({}, {}, uuid.v4());  /* jshint ignore:line */
            }).to.throw(/Unsupported platform type/);
        });

        it('should prioritize a user defined lease file', function() {
            var _job = new this.Jobclass({ leasesFile: '/user/defined' }, {}, uuid.v4());
            expect(_job.options.leasesFile).to.equal('/user/defined');
        });
    });

    it('should parse lease data', function() {
        var job = new this.Jobclass({}, {}, uuid.v4());
        var parsed = job.parseLeaseData(leaseData.toString());
        expect(parsed).to.deep.equal({
            ip: '10.1.1.3',
            mac: '08:00:27:9b:d9:f8'
        });
    });
});