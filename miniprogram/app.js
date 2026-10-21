const api = require('./utils/api');
App({
  globalData: { boot: null },
  async bootstrap() { const boot = await api.request('/bootstrap'); this.globalData.boot = boot; return boot; }
});
