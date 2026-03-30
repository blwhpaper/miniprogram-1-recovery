const db = wx.cloud.database()
const { ensureApprovedTeacherSession } = require("../../utils/teacherSession")

Page({
  data: {
    classId: "",
    lessonId: "",
    qrcode: "",
    pageLoading: false,
    pageErrorText: "",
    currentLessonStatusText: "当前暂无进行中的课堂",
    showEndLessonButton: false,
    debugAppEnv: "",
    debugCreateLessonEnv: "",
    debugCreateSignCodeEnv: "",
    debugLessonVerifyText: "",
    debugQrScene: ""
  },

  restoringCurrentLessonQr: false,
  lessonEndPromptTimer: null,
  lessonAutoEndTimer: null,
  currentLifecycleLessonId: "",

  async ensureTeacherPageAccess() {
    const currentTeacher = await ensureApprovedTeacherSession()
    if (!currentTeacher) {
      wx.reLaunch({
        url: "/pages/teacherHome/teacherHome"
      })
      return false
    }
    return true
  },

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

  async onLoad(options) {
    if (!(await this.ensureTeacherPageAccess())) return
    const classId = String(options.classId || options.id || "").trim()
    const app = getApp()

    this.setData({
      classId,
      debugAppEnv: String(app?.globalData?.env || "").trim()
    })

    this.restoreCurrentLessonQr()
  },

  async onShow() {
    if (!(await this.ensureTeacherPageAccess())) return
    this.restoreCurrentLessonQr()
  },

  onHide() {
    this.clearLessonLifecycleTimers()
  },

  onUnload() {
    this.clearLessonLifecycleTimers()
  },

  getLessonTimestamp(value) {
    const rawValue = value && typeof value.toDate === "function" ? value.toDate() : value
    const date = rawValue instanceof Date ? rawValue : new Date(rawValue)
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date.getTime() : 0
  },

  clearLessonLifecycleTimers() {
    if (this.lessonEndPromptTimer) {
      clearTimeout(this.lessonEndPromptTimer)
    }
    if (this.lessonAutoEndTimer) {
      clearTimeout(this.lessonAutoEndTimer)
    }
    this.lessonEndPromptTimer = null
    this.lessonAutoEndTimer = null
    this.currentLifecycleLessonId = ""
  },

  async resolveCurrentLessonByCloud({ classId = "", lessonId = "" } = {}) {
    const normalizedClassId = String(classId || "").trim()
    const normalizedLessonId = String(lessonId || "").trim()
    if (!normalizedClassId) {
      return {
        ok: false,
        lesson: null,
        reason: "invalid"
      }
    }

    try {
      const res = await wx.cloud.callFunction({
        name: "resolveClassCurrentLesson",
        data: {
          classId: normalizedClassId,
          lessonId: normalizedLessonId
        }
      })
      const result = res.result || {}
      if (!result.success) {
        console.warn("[classHome] resolveCurrentLessonByCloud failed", result)
        return {
          ok: false,
          lesson: null,
          reason: "failed",
          message: String(result.msg || "").trim()
        }
      }
      return {
        ok: true,
        lesson: result.lesson || null,
        reason: result.lesson ? "resolved" : "empty",
        autoEndedLessonIds: Array.isArray(result.autoEndedLessonIds) ? result.autoEndedLessonIds : []
      }
    } catch (err) {
      console.warn("[classHome] resolveCurrentLessonByCloud failed", err)
      return {
        ok: false,
        lesson: null,
        reason: "failed",
        message: String(err?.message || err?.errMsg || "").trim()
      }
    }
  },

  async tryRestoreQrByLessonId(lessonId = "") {
    const normalizedLessonId = String(lessonId || "").trim()
    const classId = String(this.data.classId || "").trim()
    if (!normalizedLessonId || !classId) return false

    const cachedQrCode = this.getCachedQrCode(classId, normalizedLessonId)
    if (cachedQrCode) {
      this.setData({
        lessonId: normalizedLessonId,
        qrcode: cachedQrCode,
        currentLessonStatusText: "当前课进行中",
        showEndLessonButton: true
      })
      return true
    }

    this.setData({
      lessonId: normalizedLessonId,
      currentLessonStatusText: "当前课进行中",
      showEndLessonButton: true
    })
    await this.buildQrCodeForLesson(normalizedLessonId)
    return true
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

  async endCurrentLesson({ lessonId = "", silent = false } = {}) {
    const classId = String(this.data.classId || "").trim()
    const normalizedLessonId = String(lessonId || this.data.lessonId || "").trim()
    if (!classId || !normalizedLessonId) return false

    try {
      await db.collection("lessons").doc(normalizedLessonId).update({
        data: {
          status: "ended",
          endTime: db.serverDate()
        }
      })
      wx.removeStorageSync(`LATEST_LESSON_${classId}`)
      this.clearCachedQrCode(classId, normalizedLessonId)
      this.clearLessonLifecycleTimers()
      this.setData({
        lessonId: "",
        qrcode: "",
        currentLessonStatusText: "当前暂无进行中的课堂",
        showEndLessonButton: false
      })
      if (!silent) {
        wx.showToast({ title: "当前课已结束", icon: "success" })
      }
      return true
    } catch (err) {
      console.error("[classHome] endCurrentLesson failed", err)
      if (!silent) {
        wx.showToast({ title: "下课失败，请稍后重试", icon: "none" })
      }
      return false
    }
  },

  scheduleLessonLifecycle(lesson = null) {
    this.clearLessonLifecycleTimers()
    const lessonId = String(lesson?._id || lesson?.lessonId || this.data.lessonId || "").trim()
    if (!lessonId) return

    const startTimestamp = this.getLessonTimestamp(lesson?.startTime || lesson?.createdAt)
    if (!startTimestamp) return

    const now = Date.now()
    const promptDelay = startTimestamp + (100 * 60 * 1000) - now
    const autoEndDelay = startTimestamp + (115 * 60 * 1000) - now

    this.currentLifecycleLessonId = lessonId

    if (promptDelay <= 0) {
      this.promptEndLessonIfNeeded(lessonId)
    } else {
      this.lessonEndPromptTimer = setTimeout(() => {
        this.promptEndLessonIfNeeded(lessonId)
      }, promptDelay)
    }

    if (autoEndDelay <= 0) {
      this.endCurrentLesson({ lessonId, silent: true })
    } else {
      this.lessonAutoEndTimer = setTimeout(() => {
        this.endCurrentLesson({ lessonId, silent: true })
      }, autoEndDelay)
    }
  },

  promptEndLessonIfNeeded(lessonId = "") {
    const normalizedLessonId = String(lessonId || "").trim()
    if (!normalizedLessonId || normalizedLessonId !== String(this.data.lessonId || "").trim()) return

    wx.showModal({
      title: "提示下课",
      content: "当前课已进行满 100 分钟，是否现在下课？",
      confirmText: "立即下课",
      cancelText: "暂不下课",
      success: (res) => {
        if (res.confirm) {
          this.endCurrentLesson({ lessonId: normalizedLessonId })
        }
      }
    })
  },

  async restoreCurrentLessonQr() {
    const classId = String(this.data.classId || "").trim()
    if (!classId || this.restoringCurrentLessonQr) return

    const cachedLessonId = String(this.data.lessonId || wx.getStorageSync(`LATEST_LESSON_${classId}`) || "").trim()

    this.restoringCurrentLessonQr = true
    this.setData({
      pageLoading: true,
      pageErrorText: ""
    })

    try {
      const resolveResult = await this.resolveCurrentLessonByCloud({
        classId,
        lessonId: cachedLessonId
      })

      if (resolveResult.ok && resolveResult.lesson) {
        const lesson = resolveResult.lesson
        const activeLessonId = String(lesson._id || cachedLessonId).trim()
        wx.setStorageSync(`LATEST_LESSON_${classId}`, activeLessonId)
        const cachedQrCode = this.getCachedQrCode(classId, activeLessonId)
        if (cachedQrCode) {
          this.setData({
            lessonId: activeLessonId,
            qrcode: cachedQrCode,
            pageErrorText: "",
            currentLessonStatusText: "当前课进行中",
            showEndLessonButton: true
          })
          this.scheduleLessonLifecycle(lesson)
          return
        }

        this.setData({
          lessonId: activeLessonId,
          pageErrorText: "",
          currentLessonStatusText: "当前课进行中",
          showEndLessonButton: true
        })
        await this.buildQrCodeForLesson(activeLessonId)
        this.scheduleLessonLifecycle(lesson)
        return
      }

      if (!resolveResult.ok && cachedLessonId) {
        const restoredByLessonId = await this.tryRestoreQrByLessonId(cachedLessonId)
        if (restoredByLessonId) {
          wx.setStorageSync(`LATEST_LESSON_${classId}`, cachedLessonId)
          return
        }
      }

      if (!resolveResult.ok) {
        console.warn("[classHome] restoreCurrentLessonQr fallback failed", resolveResult)
        return
      }

      if (!resolveResult.lesson) {
        if (cachedLessonId) {
          wx.removeStorageSync(`LATEST_LESSON_${classId}`)
          this.clearCachedQrCode(classId, cachedLessonId)
        }
        this.clearLessonLifecycleTimers()
        this.setData({
          lessonId: "",
          qrcode: "",
          pageErrorText: "",
          currentLessonStatusText: "当前暂无进行中的课堂",
          showEndLessonButton: false
        })
        return
      }
    } catch (err) {
      console.error("[classHome] restoreCurrentLessonQr failed", err)
      this.setData({
        pageErrorText: "当前课堂状态读取失败，请稍后重试。"
      })
    } finally {
      this.restoringCurrentLessonQr = false
      this.setData({
        pageLoading: false
      })
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
      this.setData({
        pageErrorText: ""
      })
      const currentLessonResult = await this.resolveCurrentLessonByCloud({ classId })
      const existedActiveLesson = currentLessonResult.ok ? currentLessonResult.lesson : null
      if (existedActiveLesson) {
        wx.setStorageSync(`LATEST_LESSON_${classId}`, String(existedActiveLesson._id || "").trim())
        await this.restoreCurrentLessonQr()
        wx.hideLoading()
        wx.showToast({ title: "当前课进行中，已恢复二维码", icon: "none" })
        return
      }

      if (!currentLessonResult.ok && String(currentLessonResult.reason || "").trim() === "failed") {
        throw new Error(currentLessonResult.message || "当前课状态获取失败")
      }

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
      this.setData({
        currentLessonStatusText: "当前课进行中",
        showEndLessonButton: true
      })
      this.scheduleLessonLifecycle({
        _id: lessonId,
        startTime: new Date()
      })
      wx.hideLoading()
      wx.showToast({ title: "签到已开启", icon: "success" })

    } catch (err) {
      wx.hideLoading()
      console.error("签到开启失败：", err)
      this.setData({
        pageErrorText: String(err?.message || "").trim() || "当前课堂处理失败，请稍后重试。"
      })
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
  },

  confirmEndCurrentLesson() {
    const lessonId = String(this.data.lessonId || "").trim()
    if (!lessonId) {
      wx.showToast({ title: "当前没有进行中的课堂", icon: "none" })
      return
    }

    wx.showModal({
      title: "确认下课",
      content: "下课后将结束当前课并收起二维码，是否继续？",
      confirmText: "确认下课",
      cancelText: "取消",
      success: (res) => {
        if (res.confirm) {
          this.endCurrentLesson({ lessonId })
        }
      }
    })
  },

  retryRestoreCurrentLesson() {
    this.restoreCurrentLessonQr()
  }
})
