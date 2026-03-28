const db = wx.cloud.database()

Page({
  data: {
    classId: "",
    lessonId: "",
    qrcode: "",
    debugAppEnv: "",
    debugCreateLessonEnv: "",
    debugCreateSignCodeEnv: "",
    debugLessonVerifyText: "",
    debugQrScene: ""
  },

  restoringCurrentLessonQr: false,

  getQrCodeStorageKey(classId = "", lessonId = "") {
    const normalizedClassId = String(classId || "").trim()
    const normalizedLessonId = String(lessonId || "").trim()
    if (!normalizedClassId || !normalizedLessonId) return ""
    return `LATEST_QRCODE_${normalizedClassId}_${normalizedLessonId}`
  },

  getCachedQrCode(classId = "", lessonId = "") {
    const storageKey = this.getQrCodeStorageKey(classId, lessonId)
    if (!storageKey) return ""
    return String(wx.getStorageSync(storageKey) || "").trim()
  },

  cacheQrCode(classId = "", lessonId = "", qrcode = "") {
    const storageKey = this.getQrCodeStorageKey(classId, lessonId)
    const normalizedQrCode = String(qrcode || "").trim()
    if (!storageKey || !normalizedQrCode) return
    wx.setStorageSync(storageKey, normalizedQrCode)
  },

  clearCachedQrCode(classId = "", lessonId = "") {
    const storageKey = this.getQrCodeStorageKey(classId, lessonId)
    if (!storageKey) return
    wx.removeStorageSync(storageKey)
  },

  onLoad(options) {
    const classId = String(options.classId || options.id || "").trim()
    const app = getApp()

    this.setData({
      classId,
      debugAppEnv: String(app?.globalData?.env || "").trim()
    })

    this.restoreCurrentLessonQr()
  },

  onShow() {
    this.restoreCurrentLessonQr()
  },

  async getActiveLessonById(lessonId = "") {
    const normalizedLessonId = String(lessonId || "").trim()
    if (!normalizedLessonId) return null

    try {
      const res = await db.collection("lessons").doc(normalizedLessonId).get()
      const lesson = res.data || null
      if (!lesson) return null
      return String(lesson.status || "").trim() === "active" ? lesson : null
    } catch (err) {
      console.warn("[classHome] getActiveLessonById failed", {
        lessonId: normalizedLessonId,
        err
      })
      return null
    }
  },

  async buildQrCodeForLesson(lessonId = "") {
    const normalizedLessonId = String(lessonId || "").trim()
    const classId = String(this.data.classId || "").trim()
    if (!normalizedLessonId) return false

    const qrRes = await wx.cloud.callFunction({
      name: "createSignCode",
      data: { lessonId: normalizedLessonId }
    })

    if (!qrRes.result || !qrRes.result.success || !qrRes.result.buffer) {
      throw new Error(qrRes.result?.err?.message || "生成签到码失败")
    }

    const qrScene = String(qrRes.result?.scene || "").trim()
    if (qrScene && qrScene !== normalizedLessonId) {
      throw new Error("二维码参数与当前课次 id 不一致")
    }

    const base64 = wx.arrayBufferToBase64(qrRes.result.buffer)
    const imgUrl = "data:image/png;base64," + base64

    this.setData({
      lessonId: normalizedLessonId,
      qrcode: imgUrl,
      debugCreateSignCodeEnv: String(qrRes.result?.env || "").trim(),
      debugQrScene: qrScene
    })
    this.cacheQrCode(classId, normalizedLessonId, imgUrl)

    return true
  },

  async restoreCurrentLessonQr() {
    const classId = String(this.data.classId || "").trim()
    if (!classId || this.data.qrcode || this.restoringCurrentLessonQr) return

    const cachedLessonId = String(
      this.data.lessonId || wx.getStorageSync(`LATEST_LESSON_${classId}`) || ""
    ).trim()
    if (!cachedLessonId) return

    this.restoringCurrentLessonQr = true

    try {
      const lesson = await this.getActiveLessonById(cachedLessonId)
      if (!lesson) {
        wx.removeStorageSync(`LATEST_LESSON_${classId}`)
        this.clearCachedQrCode(classId, cachedLessonId)
        this.setData({
          lessonId: "",
          qrcode: ""
        })
        return
      }

      const activeLessonId = String(lesson._id || cachedLessonId).trim()
      const cachedQrCode = this.getCachedQrCode(classId, activeLessonId)
      if (cachedQrCode) {
        this.setData({
          lessonId: activeLessonId,
          qrcode: cachedQrCode
        })
        return
      }

      this.setData({
        lessonId: activeLessonId
      })
      await this.buildQrCodeForLesson(activeLessonId)
    } catch (err) {
      console.error("[classHome] restoreCurrentLessonQr failed", err)
    } finally {
      this.restoringCurrentLessonQr = false
    }
  },

  /**
   * 核心重构：生成签到码流程
   * 1. 调用云函数创建本次课程（Lesson）
   * 2. 使用返回的 lessonId 生成唯一签到码
   */
  async createSignCode() {
    const classId = String(this.data.classId || "").trim()

    if (!classId) {
      wx.showToast({ title: "请先选择班级", icon: "none" })
      return
    }

    wx.showLoading({ title: "正在开启签到...", mask: true })

    try {
      // 第一步：在云端创建一节“课”（Lesson），获取唯一 ID
      const lessonRes = await wx.cloud.callFunction({
        name: "createLesson",
        data: { classId }
      })

      if (!lessonRes.result || !lessonRes.result.success) {
        throw new Error(lessonRes.result?.msg || "创建课程失败")
      }

      const lessonId = String(lessonRes.result?.lessonId || "").trim()
      if (!lessonId) {
        throw new Error("创建课程成功但未返回 lessonId")
      }
      console.log("[classHome] createLesson result", {
        lessonId,
        result: lessonRes.result || null
      })
      wx.setStorageSync(`LATEST_LESSON_${classId}`, lessonId)
      this.setData({
        lessonId,
        debugCreateLessonEnv: String(lessonRes.result?.env || "").trim(),
        debugLessonVerifyText: lessonRes.result?.verifyExists
          ? `verify=yes classId=${String(lessonRes.result?.verifyClassId || "").trim() || "-"} status=${String(lessonRes.result?.verifyStatus || "").trim() || "-"}`
          : "verify=no"
      })

      // 第二步：使用 lessonId 生成二维码（云端鉴权并绑定参数）
      await this.buildQrCodeForLesson(lessonId)
      wx.hideLoading()
      wx.showToast({ title: "签到已开启", icon: "success" })

    } catch (err) {
      wx.hideLoading()
      console.error("签到开启失败：", err)
      wx.showModal({
        title: "错误",
        content: err.message || "无法生成签到码，请检查网络",
        showCancel: false
      })
    }
  },

  // 跳转到学生名单管理（修复：带上 classId）
  goToStudentList() {
    const classId = String(this.data.classId || "").trim()
    const latestLessonId = String(
      this.data.lessonId || wx.getStorageSync(`LATEST_LESSON_${classId}`) || ""
    ).trim()
    wx.navigateTo({
      url: `/pages/studentList/studentList?id=${classId}&lessonId=${latestLessonId}`
    })
  },

  goToClassInteraction() {
    const classId = String(this.data.classId || "").trim()
    const lessonId = String(
      this.data.lessonId || wx.getStorageSync(`LATEST_LESSON_${classId}`) || ""
    ).trim()

    if (!lessonId) {
      wx.showToast({ title: "请先生成签到码", icon: "none" })
      return
    }

    wx.navigateTo({
      url: `/pages/classInteraction/classInteraction?classId=${classId}&lessonId=${lessonId}`
    })
  }
})
