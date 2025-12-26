const fs = require('fs-extra');
const path = require('path');

global.mockfs = fs;

beforeEach(() => {
  jest.clearAllMocks();
});