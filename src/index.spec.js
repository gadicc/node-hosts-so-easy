import Hosts from './index';

describe('hosts', () => {

  const hosts = new Hosts({ noWrites: true });

  describe('modify', () => {

    beforeEach(() => {
      hosts.clearQueue();
    });

    describe('insertion / removal', () => {

      it('adds a new ip and host', () => {
        const orig = '127.0.0.1 localhost';
        const desired = '127.0.0.1 localhost\n127.0.0.2 localhost2';
        hosts.add('127.0.0.2', 'localhost2');
        expect(hosts.modify(orig)).toBe(desired);
      });

      it('adds a new hostname to existing IP', () => {
        const orig = '127.0.0.1 localhost';
        const desired = '127.0.0.1 localhost localhost2';
        hosts.add('127.0.0.1', 'localhost2');
        expect(hosts.modify(orig)).toBe(desired);
      });

      it('adding a duplicate host does not add it twice', () => {
        const orig = '127.0.0.1 localhost';
        hosts.add('127.0.0.1', 'localhost');
        expect(hosts.modify(orig)).toBe(orig);
      });

      it('removes a single hostname from an existing IP', () => {
        const orig = '127.0.0.1 localhost localhost2';
        const desired = '127.0.0.1 localhost';
        hosts.remove('127.0.0.1', 'localhost2');
        expect(hosts.modify(orig)).toBe(desired);
      });

      it('removes line for IP with no hosts', () => {
        const orig = '127.0.0.1 localhost';
        const desired = '';
        hosts.remove('127.0.0.1', 'localhost');
        expect(hosts.modify(orig)).toBe(desired);
      });

      it('removes a single hostname from any IP', () => {
        const orig = '127.0.0.1 localhost admin';
        const desired = '127.0.0.1 localhost';
        hosts.removeHost('admin');
        expect(hosts.modify(orig)).toBe(desired);
      });

    });

    describe('preserves formatting', () => {

      it('leaves comments and newlines intact', () => {
        const orig = '# hosts\n\n127.0.0.1 localhost';
        const desired = '# hosts\n\n127.0.0.1 localhost localhost2';
        hosts.add('127.0.0.1', 'localhost2');
        expect(hosts.modify(orig)).toBe(desired);
      });

      it('inserts comments before a final comment block', () => {
        const orig = '# start hosts\n\n127.0.0.1 localhost\n\n# end hosts';
        const desired = '# start hosts\n\n127.0.0.1 localhost\n127.0.0.2 localhost2\n\n# end hosts';
        hosts.add('127.0.0.2', 'localhost2');
        expect(hosts.modify(orig)).toBe(desired);
      });

      it('preserves existing spaces & tabs', () => {
        const orig = '127.0.0.1\t\tlocalhost   localhost2';
        const desired = '127.0.0.1\t\tlocalhost   localhost2 localhost3';
        hosts.add('127.0.0.1', 'localhost3');
        expect(hosts.modify(orig)).toBe(desired);
      });

    });

  });

});
