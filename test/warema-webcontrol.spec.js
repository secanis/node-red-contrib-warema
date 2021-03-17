const helper = require('node-red-node-test-helper');

const webControl = require('../warema-webcontrol');

describe('warema-webcontrol Node', () => {
    afterEach(() => {
        helper.unload();
    });

    it('should be loaded', (done) => {
        const flow = [{ id: 'n1', type: 'warema-webcontrol', name: 'keba name' }];
        helper.load(webControl, flow, () => {
            const n1 = helper.getNode('n1');
            n1.should.have.property('name', 'keba name');
            done();
        });
    });
});
