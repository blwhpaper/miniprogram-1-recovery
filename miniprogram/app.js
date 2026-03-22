// app.js
App({
  cacheLaunchEntryOptions(source, options = {}) {
    const safeOptions = {
      path: options.path || "",
      scene: options.scene || 0,
      query: options.query || {},
      referrerInfo: options.referrerInfo || {},
      apiCategory: options.apiCategory || ""
    };

    if (!this.globalData) {
      this.globalData = {};
    }
    this.globalData.launchEntryOptions = safeOptions;

  },

  onLaunch: function (options) {
    this.globalData = {
      // env 参数说明：
      // env 参数决定接下来小程序发起的云开发调用（wx.cloud.xxx）会请求到哪个云环境的资源
      // 此处请填入环境 ID, 环境 ID 可在微信开发者工具右上顶部工具栏点击云开发按钮打开获取
      env: "cloud1-2gth4gqe76c8a563",
      launchEntryOptions: {}
    };

    const launchOptions = wx.getLaunchOptionsSync ? wx.getLaunchOptionsSync() : {};
    this.cacheLaunchEntryOptions("onLaunch", options && Object.keys(options).length ? options : launchOptions);

    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
    } else {
      wx.cloud.init({
        env: this.globalData.env,
        traceUser: true,
      });
    }
  },

  onShow: function (options) {
    const enterOptions = wx.getEnterOptionsSync ? wx.getEnterOptionsSync() : {};
    this.cacheLaunchEntryOptions("onShow", options && Object.keys(options).length ? options : enterOptions);
  },
});
