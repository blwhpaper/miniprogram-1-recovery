Page({
  data: {
    name: "",
    studentId: "",
    confirmStudentId: "",
    studentId2: "",
    scene: "",
    lessonId: ""
  },

  safeDecode(value = "") {
    let result = String(value || "");
    for (let i = 0; i < 2; i++) {
      try {
        const decoded = decodeURIComponent(result);
        if (decoded === result) break;
        result = decoded;
      } catch (err) {
        break;
      }
    }
    return result;
  },

  getLessonIdFromQuery(value = "") {
    const decodedValue = this.safeDecode(value).trim();
    if (!decodedValue) return "";

    const queryString = decodedValue.includes("?")
      ? decodedValue.split("?")[1]
      : decodedValue;

    const params = {};
    queryString.split("&").forEach((item) => {
      if (!item) return;

      const [rawKey = "", ...rest] = item.split("=");
      const key = this.safeDecode(rawKey);
      const paramValue = this.safeDecode(rest.join("="));
      params[key] = paramValue;
    });

    return params.lessonId || params.scene || "";
  },

  parseLessonIdFromOptions(options = {}) {
    const directLessonId = this.safeDecode(options.lessonId || "").trim();
    if (directLessonId) {
      return directLessonId;
    }

    const scene = this.safeDecode(options.scene || "").trim();
    if (scene) {
      if (scene.includes("=") || scene.includes("&")) {
        return this.getLessonIdFromQuery(scene);
      }
      return scene;
    }

    return this.getLessonIdFromQuery(options.q || "");
  },

  parseEntryParams(options = {}) {
    const scene = this.safeDecode(options.scene || options.q || "").trim();
    return {
      scene,
      lessonId: this.parseLessonIdFromOptions(options)
    };
  },

  getLaunchEntryParams() {
    const app = getApp();
    const launchOptions = app && app.globalData
      ? app.globalData.launchEntryOptions || {}
      : {};
    return this.parseEntryParams(launchOptions.query || {});
  },

  resolveEntryParams() {
    const dataScene = this.safeDecode(this.data.scene).trim();
    const dataLessonId = this.safeDecode(this.data.lessonId).trim();
    const launchEntry = this.getLaunchEntryParams();
    const pendingLessonId = this.safeDecode(wx.getStorageSync("pendingLessonId") || "").trim();

    return {
      scene: dataScene || launchEntry.scene || "",
      lessonId: dataLessonId || launchEntry.lessonId || pendingLessonId
    };
  },

  buildTargetUrl(pagePath, entry = {}) {
    const params = [];
    if (entry.scene) {
      params.push(`scene=${encodeURIComponent(entry.scene)}`);
    }
    if (entry.lessonId) {
      params.push(`lessonId=${encodeURIComponent(entry.lessonId)}`);
    }
    return params.length
      ? `${pagePath}?${params.join("&")}`
      : pagePath;
  },

  onLoad(options = {}) {
    const pageEntry = this.parseEntryParams(options);
    const launchEntry = this.getLaunchEntryParams();
    const lessonId = pageEntry.lessonId || launchEntry.lessonId || String(wx.getStorageSync("pendingLessonId") || "").trim();
    const scene = pageEntry.scene || launchEntry.scene || "";

    if (lessonId) {
      wx.setStorageSync("pendingLessonId", lessonId);
    }

    console.log("[register] page lessonId =", lessonId);

    this.setData({
      scene,
      lessonId
    });
  },

  buildStudentSignUrl() {
    const { lessonId } = this.resolveEntryParams();
    console.log("[register] navigate back lessonId =", lessonId);
    return lessonId
      ? `/pages/studentSign/studentSign?lessonId=${encodeURIComponent(lessonId)}`
      : "/pages/studentSign/studentSign";
  },

  inputName(e) {
    this.setData({
      name: String(e.detail.value || '').trim()
    })
  },

  inputPwd(e) {
    this.setData({
      studentId: String(e.detail.value || '').trim()
    })
  },

  inputPwd2(e) {
    this.setData({
      confirmStudentId: String(e.detail.value || '').trim()
    })
  },

  async doRegister() {
    const name = this.data.name.trim();
    const studentId = this.data.studentId.trim();
    const studentId2 = String(this.data.confirmStudentId || this.data.studentId2 || "").trim();
    const { lessonId: recoveredLessonId } = this.resolveEntryParams();

    if (recoveredLessonId && recoveredLessonId !== this.data.lessonId) {
      this.setData({ lessonId: recoveredLessonId });
    }

    const lessonId = recoveredLessonId;

    if (!name) {
      wx.showToast({ title: "请输入姓名", icon: "none" });
      return;
    }
    if (!studentId) {
      wx.showToast({ title: "请输入学号", icon: "none" });
      return;
    }
    if (!studentId2) {
      wx.showToast({ title: "请再次输入学号", icon: "none" });
      return;
    }
    if (studentId !== studentId2) {
      wx.showToast({ title: "两次学号不一致", icon: "none" });
      return;
    }
    if (!lessonId) {
      wx.showToast({ title: "缺少当前签到课信息，请重新扫码", icon: "none" });
      return;
    }

    wx.showLoading({ title: "绑定中...", mask: true });

    try {
      const payload = {
        lessonId,
        studentId,
        name
      };
      console.log("[register] bind payload =", payload);
      const res = await wx.cloud.callFunction({
        name: "bindStudent",
        data: payload
      });

      wx.hideLoading();

      if (!res.result || !res.result.success) {
        wx.showToast({
          title: res.result && res.result.msg ? res.result.msg : "绑定失败",
          icon: "none"
        });
        return;
      }

      wx.showModal({
        title: "绑定成功",
        content: "绑定成功，正在返回签到页面",
        showCancel: false,
        success: () => {
          wx.reLaunch({
            url: this.buildStudentSignUrl()
          });
        }
      });
    } catch (err) {
      wx.hideLoading();
      console.error("bindStudent failed:", err);
      wx.showToast({ title: "服务请求失败", icon: "none" });
    }
  }
});
