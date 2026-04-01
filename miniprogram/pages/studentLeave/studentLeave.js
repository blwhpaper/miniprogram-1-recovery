const db = wx.cloud.database()

Page({
  data: {
    lessonId: "",
    classId: "",
    classRoster: [],
    name: "",
    studentId: "",
    currentUser: null,
    shouldGoRegister: false,
    registerTipText: "先绑定学生身份",
    pageHintText: "加载中",
    hasBoundStudentSession: false,
    attendanceStatus: "unsigned",
    attendanceStatusText: "未签到",
    signSuccess: false,
    leaveRequestTargetName: "",
    leaveRequestTargetStatus: "empty",
    leaveRequestTargetStatusText: "先填姓名",
    leaveRequestMatchedStudentId: "",
    leaveRequestMatchedStudentName: "",
    leaveRequestImageTempPath: "",
    leaveRequestImageFileId: "",
    leaveRequestSubmitting: false,
    canSubmitLeaveRequest: false,
    leaveRequestLastSubmittedEventId: "",
    leaveRequestLastSubmittedName: "",
    leaveRequestLastSubmittedStatus: "",
    leaveRequestLastSubmittedStatusText: "",
    leaveRequestLastSubmittedTimeText: "",
    leaveRequestLastSubmittedTitle: ""
  },

  getPendingLessonId() {
    return String(wx.getStorageSync("pendingLessonId") || "").trim()
  },

  resolveLessonId() {
    return String(this.data.lessonId || this.getPendingLessonId() || "").trim()
  },

  ensureBoundStudentSession(actionLabel = "当前操作") {
    if (this.data.hasBoundStudentSession) return true
    wx.showToast({ title: `请先绑定后再${actionLabel}`, icon: "none" })
    return false
  },

  getAttendanceStatusLabel(status = "") {
    const normalizedStatus = String(status || "").trim()
    const map = {
      signed: "已签到",
      unsigned: "未签到",
      absent: "旷课",
      leave_wait: "待审批",
      leave_agree: "已请假"
    }
    return map[normalizedStatus || "unsigned"] || "未签到"
  },

  getLeaveRequestStatusLabel(status = "") {
    const normalizedStatus = String(status || "").trim() || "pending"
    const map = {
      pending: "已提交",
      approved: "已确认",
      closed: "已关闭"
    }
    return map[normalizedStatus] || "已提交"
  },

  formatSimpleDateTime(value) {
    const rawValue = value && typeof value.toDate === "function" ? value.toDate() : value
    const date = rawValue instanceof Date ? rawValue : new Date(rawValue)
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      return ""
    }

    const pad = (num) => String(num).padStart(2, "0")
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  },

  getLeaveRequestEventTimestamp(item = {}) {
    const payload = item?.payload || {}
    const candidateList = [payload.submittedAt, item.updatedAt, item.createdAt]

    for (let i = 0; i < candidateList.length; i += 1) {
      const rawValue = candidateList[i]
      if (!rawValue) continue

      if (typeof rawValue?.toDate === "function") {
        const date = rawValue.toDate()
        if (date instanceof Date && !Number.isNaN(date.getTime())) {
          return date.getTime()
        }
      }

      if (rawValue instanceof Date && !Number.isNaN(rawValue.getTime())) {
        return rawValue.getTime()
      }

      const date = new Date(rawValue)
      if (!Number.isNaN(date.getTime())) {
        return date.getTime()
      }
    }

    return 0
  },

  getLeaveRequestCloudPath(tempFilePath = "") {
    const extensionMatch = String(tempFilePath || "").match(/\.([^.\/?#]+)(?:[?#].*)?$/)
    const extension = extensionMatch ? extensionMatch[1] : "jpg"
    const lessonId = this.resolveLessonId() || "lesson"
    const studentId = String(this.data.studentId || "").trim() || "student"
    return `leave-request/${lessonId}/${studentId}_${Date.now()}.${extension}`
  },

  canSubmitLeaveRequest(state = {}) {
    return Boolean(
      (state.signSuccess !== undefined ? state.signSuccess : this.data.signSuccess) &&
      (state.leaveRequestTargetStatus !== undefined ? state.leaveRequestTargetStatus : this.data.leaveRequestTargetStatus) === "matched" &&
      String(state.leaveRequestImageTempPath !== undefined ? state.leaveRequestImageTempPath : this.data.leaveRequestImageTempPath || "").trim() &&
      !(state.leaveRequestSubmitting !== undefined ? state.leaveRequestSubmitting : this.data.leaveRequestSubmitting)
    )
  },

  async getReadableLesson(lessonId = "", logLabel = "") {
    const normalizedLessonId = String(lessonId || "").trim()
    if (!normalizedLessonId) return null

    try {
      const lessonRes = await db.collection("lessons").doc(normalizedLessonId).get()
      return lessonRes.data || null
    } catch (err) {
      console.warn(`[studentLeave] ${logLabel || "getReadableLesson"} skip invalid lesson`, {
        lessonId: normalizedLessonId,
        err
      })
      return null
    }
  },

  async ensureLessonClassId() {
    const lessonId = this.resolveLessonId()
    const studentId = String(this.data.studentId || "").trim()
    if (!lessonId) return ""

    const currentClassId = String(this.data.classId || "").trim()
    if (currentClassId) {
      this.setData({ lessonId, classId: currentClassId })
      return currentClassId
    }

    const lesson = await this.getReadableLesson(lessonId, "ensureLessonClassId")
    const lessonClassId = String(lesson?.classId || "").trim()
    if (lessonClassId) {
      this.setData({ lessonId, classId: lessonClassId })
      return lessonClassId
    }

    if (!studentId) return ""

    try {
      const attendanceRes = await db.collection("attendance")
        .where({ lessonId, studentId })
        .limit(1)
        .get()
      const attendanceClassId = String(attendanceRes.data?.[0]?.classId || "").trim()
      if (attendanceClassId) {
        this.setData({ lessonId, classId: attendanceClassId })
        return attendanceClassId
      }
    } catch (err) {
      console.error("[studentLeave] ensureLessonClassId fallback failed", err)
    }

    return ""
  },

  async loadClassRoster() {
    const classId = String(this.data.classId || "").trim()
    if (!classId) {
      this.setData({ classRoster: [] })
      this.updateLeaveRequestTargetMatch(this.data.leaveRequestTargetName)
      return []
    }

    try {
      const classRes = await db.collection("classes").doc(classId).get()
      const roster = Array.isArray(classRes.data?.roster) ? classRes.data.roster : []
      this.setData({ classRoster: roster })
      this.updateLeaveRequestTargetMatch(this.data.leaveRequestTargetName)
      return roster
    } catch (err) {
      console.error("[studentLeave] loadClassRoster failed", err)
      this.setData({ classRoster: [] })
      this.updateLeaveRequestTargetMatch(this.data.leaveRequestTargetName)
      return []
    }
  },

  updateLeaveRequestTargetMatch(targetName = "") {
    const requestedStudentNameInput = String(targetName || "").trim()
    const classRoster = Array.isArray(this.data.classRoster) ? this.data.classRoster : []
    const applicantStudentId = String(this.data.studentId || "").trim()

    if (!requestedStudentNameInput) {
      this.setData({
        leaveRequestTargetStatus: "empty",
        leaveRequestTargetStatusText: "先填姓名",
        leaveRequestMatchedStudentId: "",
        leaveRequestMatchedStudentName: "",
        canSubmitLeaveRequest: this.canSubmitLeaveRequest({
          leaveRequestTargetStatus: "empty",
          leaveRequestMatchedStudentName: "",
          leaveRequestMatchedStudentId: ""
        })
      })
      return null
    }

    if (classRoster.length === 0) {
      this.setData({
        leaveRequestTargetStatus: "idle",
        leaveRequestTargetStatusText: "名单加载中",
        leaveRequestMatchedStudentId: "",
        leaveRequestMatchedStudentName: "",
        canSubmitLeaveRequest: this.canSubmitLeaveRequest({
          leaveRequestTargetStatus: "idle",
          leaveRequestMatchedStudentName: "",
          leaveRequestMatchedStudentId: ""
        })
      })
      return null
    }

    const matchedStudents = classRoster.filter((item) => {
      const rosterName = String(item?.name || "").trim()
      return rosterName === requestedStudentNameInput
    })

    if (matchedStudents.length === 0) {
      this.setData({
        leaveRequestTargetStatus: "not_found",
        leaveRequestTargetStatusText: "未匹配到该学生",
        leaveRequestMatchedStudentId: "",
        leaveRequestMatchedStudentName: "",
        canSubmitLeaveRequest: this.canSubmitLeaveRequest({
          leaveRequestTargetStatus: "not_found",
          leaveRequestMatchedStudentName: "",
          leaveRequestMatchedStudentId: ""
        })
      })
      return null
    }

    if (matchedStudents.length > 1) {
      this.setData({
        leaveRequestTargetStatus: "duplicate",
        leaveRequestTargetStatusText: "同名学生过多",
        leaveRequestMatchedStudentId: "",
        leaveRequestMatchedStudentName: "",
        canSubmitLeaveRequest: this.canSubmitLeaveRequest({
          leaveRequestTargetStatus: "duplicate",
          leaveRequestMatchedStudentName: "",
          leaveRequestMatchedStudentId: ""
        })
      })
      return null
    }

    const matchedStudent = matchedStudents[0] || {}
    const requestedStudentId = String(matchedStudent?.studentId || matchedStudent?.id || "").trim()
    const requestedStudentName = String(matchedStudent?.name || requestedStudentNameInput).trim()

    if (!requestedStudentId || !requestedStudentName) {
      this.setData({
        leaveRequestTargetStatus: "invalid",
        leaveRequestTargetStatusText: "学生信息不完整",
        leaveRequestMatchedStudentId: "",
        leaveRequestMatchedStudentName: "",
        canSubmitLeaveRequest: this.canSubmitLeaveRequest({
          leaveRequestTargetStatus: "invalid",
          leaveRequestMatchedStudentName: "",
          leaveRequestMatchedStudentId: ""
        })
      })
      return null
    }

    if (requestedStudentId === applicantStudentId) {
      this.setData({
        leaveRequestTargetStatus: "self",
        leaveRequestTargetStatusText: "不能给自己提交",
        leaveRequestMatchedStudentId: requestedStudentId,
        leaveRequestMatchedStudentName: requestedStudentName,
        canSubmitLeaveRequest: this.canSubmitLeaveRequest({
          leaveRequestTargetStatus: "self",
          leaveRequestMatchedStudentName: requestedStudentName,
          leaveRequestMatchedStudentId: requestedStudentId
        })
      })
      return null
    }

    this.setData({
      leaveRequestTargetStatus: "matched",
      leaveRequestTargetStatusText: `已匹配：${requestedStudentName}`,
      leaveRequestMatchedStudentId: requestedStudentId,
      leaveRequestMatchedStudentName: requestedStudentName,
      canSubmitLeaveRequest: this.canSubmitLeaveRequest({
        leaveRequestTargetStatus: "matched",
        leaveRequestMatchedStudentName: requestedStudentName,
        leaveRequestMatchedStudentId: requestedStudentId
      })
    })

    return {
      requestedStudentId,
      requestedStudentName
    }
  },

  async loadLatestLeaveRequestSubmission(displayMode = "history") {
    const lessonId = this.resolveLessonId()
    const applicantStudentId = String(this.data.studentId || "").trim()

    if (!lessonId || !applicantStudentId) {
      this.setData({
        leaveRequestLastSubmittedEventId: "",
        leaveRequestLastSubmittedName: "",
        leaveRequestLastSubmittedStatus: "",
        leaveRequestLastSubmittedStatusText: "",
        leaveRequestLastSubmittedTimeText: "",
        leaveRequestLastSubmittedTitle: ""
      })
      return null
    }

    try {
      const res = await db.collection("lessonEvent")
        .where({
          lessonId,
          type: "leave_request",
          "payload.applicantStudentId": applicantStudentId
        })
        .limit(100)
        .get()
      const matched = (res.data || [])
        .sort((left, right) => this.getLeaveRequestEventTimestamp(right) - this.getLeaveRequestEventTimestamp(left))[0] || null

      if (!matched) {
        this.setData({
          leaveRequestLastSubmittedEventId: "",
          leaveRequestLastSubmittedName: "",
          leaveRequestLastSubmittedStatus: "",
          leaveRequestLastSubmittedStatusText: "",
          leaveRequestLastSubmittedTimeText: "",
          leaveRequestLastSubmittedTitle: ""
        })
        return null
      }

      const payload = matched.payload || {}
      const status = String(payload.status || "").trim() || "pending"
      const nextTitle = displayMode === "current"
        ? "已提交"
        : "最近记录"
      this.setData({
        leaveRequestLastSubmittedEventId: String(matched._id || "").trim(),
        leaveRequestLastSubmittedName: String(payload.requestedStudentName || matched.studentName || "").trim(),
        leaveRequestLastSubmittedStatus: status,
        leaveRequestLastSubmittedStatusText: this.getLeaveRequestStatusLabel(status),
        leaveRequestLastSubmittedTimeText: this.formatSimpleDateTime(payload.submittedAt || matched.updatedAt || matched.createdAt),
        leaveRequestLastSubmittedTitle: nextTitle
      })
      return matched
    } catch (err) {
      console.error("[studentLeave] loadLatestLeaveRequestSubmission failed", err)
      return null
    }
  },

  async restoreSignSuccessStatus() {
    const lessonId = this.resolveLessonId()
    const studentId = String(this.data.studentId || "").trim()

    if (!lessonId || !studentId) {
      this.setData({
        signSuccess: false,
        attendanceStatus: "unsigned",
        attendanceStatusText: "未签到",
        canSubmitLeaveRequest: false
      })
      return false
    }

    try {
      const res = await db.collection("attendance")
        .where({ lessonId, studentId })
        .limit(1)
        .get()
      const attendanceDoc = Array.isArray(res.data) ? res.data[0] || null : null
      const attendanceStatus = String(
        attendanceDoc?.status ||
        attendanceDoc?.attendanceStatus ||
        "unsigned"
      ).trim() || "unsigned"
      const hasSigned = attendanceStatus === "signed"
      this.setData({
        signSuccess: hasSigned,
        attendanceStatus,
        attendanceStatusText: this.getAttendanceStatusLabel(attendanceStatus),
        canSubmitLeaveRequest: this.canSubmitLeaveRequest({ signSuccess: hasSigned })
      })
      return hasSigned
    } catch (err) {
      console.error("[studentLeave] restoreSignSuccessStatus failed", err)
      return false
    }
  },

  async chooseLeaveRequestImage() {
    if (!this.ensureBoundStudentSession("请假申请")) return

    try {
      const res = await wx.chooseMedia({
        count: 1,
        mediaType: ["image"],
        sourceType: ["album", "camera"]
      })
      const tempFilePath = String(res.tempFiles?.[0]?.tempFilePath || "").trim()
      if (!tempFilePath) return
      this.setData({
        leaveRequestImageTempPath: tempFilePath,
        canSubmitLeaveRequest: this.canSubmitLeaveRequest({
          leaveRequestImageTempPath: tempFilePath
        })
      })
    } catch (err) {
      if (err?.errMsg && err.errMsg.includes("cancel")) return
      console.error("[studentLeave] chooseLeaveRequestImage failed", err)
      wx.showToast({ title: "选择假条失败", icon: "none" })
    }
  },

  onInputLeaveRequestTargetName(e) {
    const targetName = String(e.detail?.value || "").trim()
    this.setData({
      leaveRequestTargetName: targetName
    })
    this.updateLeaveRequestTargetMatch(targetName)
  },

  async submitLeaveRequest() {
    if (!this.ensureBoundStudentSession("请假申请")) return

    if (!this.data.signSuccess) {
      wx.showToast({ title: "请先签到后再申请请假", icon: "none" })
      return
    }

    if (this.data.attendanceStatus === "leave_agree") {
      wx.showToast({ title: "当前已请假", icon: "none" })
      return
    }

    if (this.data.attendanceStatus === "absent") {
      wx.showToast({ title: "当前已被标记为旷课", icon: "none" })
      return
    }

    const tempFilePath = String(this.data.leaveRequestImageTempPath || "").trim()
    if (!tempFilePath) {
      wx.showToast({ title: "请先上传假条图片", icon: "none" })
      return
    }

    const applicantStudentId = String(this.data.studentId || "").trim()
    const applicantStudentName = String(this.data.name || "").trim()
    if (!String(this.data.leaveRequestTargetName || "").trim()) {
      wx.showToast({ title: "请先填写请假人姓名", icon: "none" })
      return
    }

    const lessonId = this.resolveLessonId()
    const classId = String((await this.ensureLessonClassId()) || this.data.classId || "").trim()

    if (!lessonId || !classId || !applicantStudentId || !applicantStudentName) {
      wx.showToast({ title: "当前课堂信息不完整", icon: "none" })
      return
    }

    try {
      if (!Array.isArray(this.data.classRoster) || this.data.classRoster.length === 0) {
        await this.loadClassRoster()
      }

      const matchedResult = this.updateLeaveRequestTargetMatch(this.data.leaveRequestTargetName)
      if (!matchedResult) {
        wx.showToast({ title: this.data.leaveRequestTargetStatusText || "请确认请假人信息", icon: "none" })
        return
      }
      const { requestedStudentId, requestedStudentName } = matchedResult

      const attendanceRes = await db.collection("attendance")
        .where({ lessonId, studentId: requestedStudentId })
        .limit(1)
        .get()
      const currentAttendance = Array.isArray(attendanceRes.data) ? attendanceRes.data[0] || null : null
      const currentAttendanceStatus = String(
        currentAttendance?.status ||
        currentAttendance?.attendanceStatus ||
        "unsigned"
      ).trim() || "unsigned"

      if (currentAttendanceStatus === "leave_agree") {
        wx.showToast({ title: "该学生当前已请假", icon: "none" })
        return
      }

      if (currentAttendanceStatus === "absent") {
        wx.showToast({ title: "该学生当前已被标记为旷课", icon: "none" })
        return
      }

      this.setData({
        leaveRequestSubmitting: true,
        canSubmitLeaveRequest: false
      })
      wx.showLoading({ title: "提交中...", mask: true })

      const uploadRes = await wx.cloud.uploadFile({
        cloudPath: this.getLeaveRequestCloudPath(tempFilePath),
        filePath: tempFilePath
      })
      const imageFileId = String(uploadRes.fileID || "").trim()
      if (!imageFileId) {
        wx.hideLoading()
        this.setData({
          leaveRequestSubmitting: false,
          canSubmitLeaveRequest: this.canSubmitLeaveRequest({
            leaveRequestSubmitting: false
          })
        })
        wx.showToast({ title: "假条上传失败", icon: "none" })
        return
      }

      const existedRes = await db.collection("lessonEvent")
        .where({
          lessonId,
          studentId: requestedStudentId,
          type: "leave_request"
        })
        .get()
      const existedPending = (existedRes.data || []).find(
        (item) => String(item.payload?.status || "").trim() === "pending"
      )

      const payload = {
        status: "pending",
        imageFileId,
        applicantStudentId,
        applicantStudentName,
        requestedStudentId,
        requestedStudentName,
        submittedAt: db.serverDate()
      }

      if (existedPending && existedPending._id) {
        await db.collection("lessonEvent").doc(existedPending._id).update({
          data: {
            payload,
            updatedAt: db.serverDate()
          }
        })
      } else {
        await db.collection("lessonEvent").add({
          data: {
            lessonId,
            classId,
            studentId: requestedStudentId,
            studentName: requestedStudentName,
            type: "leave_request",
            score: 0,
            round: 0,
            payload,
            createdAt: db.serverDate(),
            createdBy: "student"
          }
        })
      }

      wx.hideLoading()
      this.setData({
        leaveRequestTargetName: "",
        leaveRequestTargetStatus: "empty",
        leaveRequestTargetStatusText: "先填姓名",
        leaveRequestMatchedStudentId: "",
        leaveRequestMatchedStudentName: "",
        leaveRequestImageTempPath: "",
        leaveRequestImageFileId: imageFileId,
        canSubmitLeaveRequest: false,
        leaveRequestLastSubmittedEventId: "",
        leaveRequestLastSubmittedName: requestedStudentName,
        leaveRequestLastSubmittedStatus: "pending",
        leaveRequestLastSubmittedStatusText: this.getLeaveRequestStatusLabel("pending"),
        leaveRequestLastSubmittedTimeText: this.formatSimpleDateTime(new Date()),
        leaveRequestLastSubmittedTitle: "已提交",
        leaveRequestSubmitting: false
      })
      wx.showToast({
        title: "请假申请已提交",
        icon: "none"
      })
      await this.loadLatestLeaveRequestSubmission("current")
    } catch (err) {
      wx.hideLoading()
      this.setData({
        leaveRequestSubmitting: false,
        canSubmitLeaveRequest: this.canSubmitLeaveRequest({
          leaveRequestSubmitting: false
        })
      })
      console.error("[studentLeave] submitLeaveRequest failed", err)
      wx.showToast({ title: "请假申请失败，请稍后重试", icon: "none" })
    }
  },

  goRegister() {
    const lessonId = this.resolveLessonId()
    if (!lessonId) {
      wx.showToast({ title: "请重新扫码老师二维码", icon: "none" })
      return
    }

    wx.navigateTo({
      url: `/pages/register/register?lessonId=${encodeURIComponent(lessonId)}&scene=${encodeURIComponent(lessonId)}`,
      fail: (err) => {
        console.error("[studentLeave] goRegister failed", err)
        wx.showToast({ title: "未能打开绑定页面", icon: "none" })
      }
    })
  },

  async initPageState(lessonId = "") {
    wx.showLoading({ title: "加载中...", mask: true })
    try {
      const res = await wx.cloud.callFunction({ name: "getMyUser" })
      const result = res.result || {}

      wx.hideLoading()

      if (!result.success) {
        wx.showToast({ title: result.msg || "身份校验失败", icon: "none" })
        return
      }

      const currentUser = result.user || {}
      const hasName = !!String(currentUser.name || "").trim()
      const hasStudentId = !!String(currentUser.studentId || "").trim()
      const shouldGoRegister = !result.bound || !hasName || !hasStudentId
      const finalLessonId = String(lessonId || this.getPendingLessonId() || "").trim()

      wx.setStorageSync("currentUser", currentUser)
      if (finalLessonId) {
        wx.setStorageSync("pendingLessonId", finalLessonId)
      }

      this.setData({
        lessonId: finalLessonId,
        classId: currentUser.classId || "",
        name: currentUser.name || "",
        studentId: currentUser.studentId || "",
        currentUser,
        shouldGoRegister,
        registerTipText: shouldGoRegister
          ? "先绑定后提交"
          : "",
        pageHintText: finalLessonId
          ? "可提交请假"
          : "暂无课次",
        hasBoundStudentSession: !shouldGoRegister && !!currentUser && hasName && hasStudentId
      })

      if (!finalLessonId) {
        wx.showToast({ title: "暂无课次", icon: "none" })
        return
      }

      if (shouldGoRegister) {
        return
      }

      await this.ensureLessonClassId()
      await this.loadClassRoster()
      await this.restoreSignSuccessStatus()
      await this.loadLatestLeaveRequestSubmission("history")
    } catch (err) {
      wx.hideLoading()
      console.error("[studentLeave] initPageState failed", err)
      wx.showToast({ title: "服务请求失败", icon: "none" })
    }
  },

  onLoad(options = {}) {
    const lessonId = String(options.lessonId || this.getPendingLessonId() || "").trim()
    this.setData({
      lessonId,
      pageHintText: lessonId
        ? "加载中"
        : "检查中"
    })
    this.initPageState(lessonId)
  },

  async onShow() {
    const lessonId = this.resolveLessonId()
    if (!lessonId) return

    if (!this.data.hasBoundStudentSession) {
      await this.initPageState(lessonId)
      return
    }

    await this.ensureLessonClassId()
    await this.loadClassRoster()
    await this.restoreSignSuccessStatus()
    await this.loadLatestLeaveRequestSubmission("history")
  }
})
