jest.mock('github');

const fn = require('../').processNextVersion;
const unchanged = require('./fixtures/test-commits.json');
const patch = require('./fixtures/patch-commits.json');
const bad = require('./fixtures/bad-commits.json');

describe('calculate next change', () => {
  test('test commits do not bump', async () => {
    const res = await fn('remy/nodemon', unchanged, '1.0.0');
    // console.log(res);
    expect(res.state).toEqual('success');
    expect(res.description.includes('unchanged')).toBe(true);
  });

  test('fix commits increment patch', async () => {
    const res = await fn('remy/nodemon', patch, '1.0.0');
    expect(res.state).toEqual('success');
    expect(res.description.includes('1.0.1')).toBe(true);
    expect(res.description.includes('unchanged')).toBe(false);
  });

  test('bad commits submit a failure', async () => {
    const res = await fn('remy/nodemon', bad, '1.0.0');
    expect(res.state).toEqual('failure');
    expect(res.description.includes('1.')).toBe(false);
  });
});
