const db = wx.cloud.database()
const _ = db.command
const { ensureApprovedTeacherSession } = require("../../utils/teacherSession");

Page({
  data: {
    classId: "",
    lessonId: "",
    pageLoading: false,
    pageErrorText: "",
    lessons: [],
    selectedLessonId: "",
    lessonsLoading: false,
    baseRosterList: [],
    stats: [],
    currentStats: null,
    statsLoading: false,
    list: [], // 最终展示的混合列表
    detailExportDisabled: true,
    statsExportDisabled: true,
    signedStudents: [],
    currentCalledStudent: null,
    lessonEvents: [],
    lessonEventsLoading: false,
    interactionScoreOptions: [60, 80, 95],
    currentRound: 1,
    currentRoundCalledIds: [],
    pendingScoreLock: false,
    pendingLeaveRequests: [],
    pendingQuestionRequests: [],
    currentQuestionRequest: null,
    currentPublishedTest: null,
    currentTestRecords: [],
    signCount: 0,
    unsignCount: 0,
    absentCount: 0,
    waitCount: 0,
    leaveCount: 0,
    isCurrentLessonSelected: false,
    jumpCursor: {}
  },

  attendancePollingTimer: null,
  attendancePollingLessonId: "",
  lessonEventPollingTimer: null,
  lessonEventPollingLessonId: "",
  latestAttendanceDocs: [],
  latestAttendanceSignature: "",
  recentAnswerScoreKeys: new Set(),
  isInitializing: false,
  isHydratingLesson: false,
  statsRequestKey: "",
  statsRequestPromise: null,
  historyStatsLoadedClassId: "",
  attendanceRequestKey: "",
  attendanceRequestPromise: null,
  lessonEventRequestKey: "",
  lessonEventRequestPromise: null,
  lessonEventRequestSeq: 0,
  attendanceCacheByLesson: new Map(),
  lessonEventCacheByLesson: new Map(),
  latestLessonEventSeqByLesson: new Map(),
  listRowIndexByStudentKey: new Map(),
  listRowIndexSource: null,
  postSwitchSnapshot: null,

  async ensureTeacherPageAccess() {
    const currentTeacher = await ensureApprovedTeacherSession();
    if (!currentTeacher) {
      this.clearAttendancePolling();
      this.clearLessonEventPolling();
      wx.reLaunch({
        url: "/pages/teacherHome/teacherHome"
      });
      return false;
    }
    return true;
  },

  ensureRuntimeCaches() {
    if (!(this.attendanceCacheByLesson instanceof Map)) {
      this.attendanceCacheByLesson = new Map();
    }
    if (!(this.lessonEventCacheByLesson instanceof Map)) {
      this.lessonEventCacheByLesson = new Map();
    }
    if (!(this.latestLessonEventSeqByLesson instanceof Map)) {
      this.latestLessonEventSeqByLesson = new Map();
    }
    if (!(this.listRowIndexByStudentKey instanceof Map)) {
      this.listRowIndexByStudentKey = new Map();
    }
    if (typeof this.listRowIndexSource === "undefined") {
      this.listRowIndexSource = null;
    }
    if (!this.postSwitchSnapshot || typeof this.postSwitchSnapshot !== "object") {
      this.postSwitchSnapshot = null;
    }
    if (!Array.isArray(this.latestAttendanceDocs)) {
      this.latestAttendanceDocs = [];
    }
    if (typeof this.latestAttendanceSignature !== "string") {
      this.latestAttendanceSignature = "";
    }
    if (!(this.recentAnswerScoreKeys instanceof Set)) {
      this.recentAnswerScoreKeys = new Set();
    }
    if (!Number.isFinite(this.lessonEventRequestSeq)) {
      this.lessonEventRequestSeq = 0;
    }
  },

  normalizeRosterItem(student) {
    if (typeof student === "string") {
      return {
        studentId: "",
        name: student,
        status: "unsigned",
        img: "",
        answerScoreText: "",
        questionScoreText: "",
        testScoreText: "",
        statusLabel: "未签到",
        attendanceScoreText: "",
        answerScoreAvgText: "",
        questionScoreAvgText: "",
        testScoreAvgText: "",
        lessonScoreText: "",
        lessonScoreBreakdownText: ""
      };
    }

    return {
      studentId: String(student?.studentId || student?.id || "").trim(),
      name: String(student?.name || "").trim(),
      status: "unsigned",
      img: "",
      answerScoreText: "",
      questionScoreText: "",
      testScoreText: "",
      statusLabel: "未签到",
      attendanceScoreText: "",
      answerScoreAvgText: "",
      questionScoreAvgText: "",
      testScoreAvgText: "",
      lessonScoreText: "",
      lessonScoreBreakdownText: ""
    };
  },

  cloneBaseRosterList() {
    return (this.data.baseRosterList || []).map((item) => ({ ...item }));
  },

  mergeAttendanceIntoList(baseList, docs = []) {
    const attendanceByStudentId = new Map();
    const attendanceByName = new Map();

    docs.forEach((doc) => {
      const studentId = String(doc.studentId || "").trim();
      const studentName = String(doc.studentName || "").trim();

      if (studentId) attendanceByStudentId.set(studentId, doc);
      if (studentName) attendanceByName.set(studentName, doc);
    });

    return baseList.map((item) => {
      const matchedById = item.studentId && attendanceByStudentId.get(item.studentId);
      const matchedByName = item.name && attendanceByName.get(item.name);

      const matchedDoc =
        matchedById ||
        matchedByName;

      if (!matchedDoc) {
        return {
          ...item,
          statusLabel: this.getSignStatusLabel(item.status)
        };
      }

      const status = String(
        matchedDoc.status ||
        matchedDoc.attendanceStatus ||
        "signed"
      ).trim() || "signed";

      return {
        ...item,
        status,
        statusLabel: this.getSignStatusLabel(status)
      };
    });
  },

  async onLoad(options) {
    if (!(await this.ensureTeacherPageAccess())) return;
    this.ensureRuntimeCaches();
    // 从上一页（classHome 或 studentList）传入的参数
    const lessonId = String(options.lessonId || "").trim();
    const classId = String(options.classId || "").trim();

    this.setData({
      lessonId,
      classId,
      selectedLessonId: lessonId
    }, () => {
      // 1. 先加载花名册（基础数据）
      // 2. 成功后拉取签到记录并启动轮询
      this.initData();
    });
  },

  async onShow() {
    if (!(await this.ensureTeacherPageAccess())) return;
    const lessonId = String(this.data.selectedLessonId || this.data.lessonId || "").trim();
    if (!lessonId || this.isInitializing || this.isHydratingLesson) return;

    const attendanceReady = this.attendancePollingLessonId === lessonId && !!this.attendancePollingTimer;
    const lessonEventReady = this.lessonEventPollingLessonId === lessonId && !!this.lessonEventPollingTimer;
    if (attendanceReady && lessonEventReady) return;

    if (!attendanceReady) {
      Promise.resolve(this.fetchAttendanceOnce(lessonId)).finally(() => {
        if (this.isLessonActive(lessonId) && !(this.attendancePollingLessonId === lessonId && this.attendancePollingTimer)) {
          this.startAttendancePolling(lessonId);
        }
      });
    }

    if (!lessonEventReady) {
      Promise.resolve(this.loadLessonEvents({
        silent: true,
        lessonId
      })).finally(() => {
        if (this.isLessonActive(lessonId) && !(this.lessonEventPollingLessonId === lessonId && this.lessonEventPollingTimer)) {
          this.startLessonEventPolling(lessonId);
        }
      });
    }
  },

  onUnload() {
    this.clearAttendancePolling();
    this.clearLessonEventPolling();
  },

  onHide() {
    this.clearAttendancePolling();
    this.clearLessonEventPolling();
  },

  async onPullDownRefresh() {
    try {
      await this.refreshAttendance();
      await this.loadLessonEvents({ silent: true });
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  async initData() {
    this.ensureRuntimeCaches();
    if (this.isInitializing) return;
    this.isInitializing = true;
    this.setData({
      pageLoading: true,
      pageErrorText: ""
    });
    wx.showLoading({ title: "加载中..." });
    try {
      const [_, lessons] = await Promise.all([
        this.loadRoster(),
        this.loadLessons()
      ]);
      const initialLessonId = this.resolveInitialLessonId(lessons);

      if (initialLessonId) {
        await this.switchLesson(initialLessonId);
      } else {
        const list = this.cloneBaseRosterList();
        const nextPatch = this.buildListViewPatch(list, { currentStats: null });
        this.setData({
          lessonId: "",
          selectedLessonId: "",
          ...nextPatch
        });
        void this.loadStats({ includeHistory: false });
      }
    } catch (err) {
      console.error("[signRecord] initData failed", err);
      this.setData({
        pageErrorText: "页面初始化失败，请重新加载后再试。"
      });
    } finally {
      this.isInitializing = false;
      this.setData({
        pageLoading: false
      });
      wx.hideLoading();
    }
  },

  retryPageLoad() {
    this.initData();
  },

  async loadStats(options = {}) {
    const classId = String(this.data.classId || "").trim();
    const lessonId = String(
      options.lessonId ||
      this.data.lessonId ||
      this.data.selectedLessonId ||
      ""
    ).trim();
    const includeHistory = options.includeHistory !== false;
    if (!classId) return;

    const requestKey = `${classId}::${lessonId}::${includeHistory ? "history" : "current"}`;
    const currentStatsLessonId = String(this.data.currentStats?.lessonId || "").trim();
    const hasHistoryStats =
      this.historyStatsLoadedClassId === classId &&
      Array.isArray(this.data.stats) &&
      this.data.stats.length > 0;

    if (!includeHistory && lessonId && currentStatsLessonId === lessonId) {
      return this.data.currentStats;
    }

    if (includeHistory && hasHistoryStats) {
      return this.data.stats;
    }

    if (this.statsRequestPromise && this.statsRequestKey === requestKey) {
      return this.statsRequestPromise;
    }

    this.setData({ statsLoading: true });
    this.refreshExportDisabledState();
    const requestPromise = (async () => {
      try {
      const res = await wx.cloud.callFunction({
        name: "getLessonStatsByClass",
        data: {
          classId,
          lessonId,
          includeHistory
        }
      });

      if (this.statsRequestPromise !== requestPromise) {
        return null;
      }

      if (res.result && res.result.success) {
        const historyIncluded = res.result.historyIncluded !== false;
        const nextStats = historyIncluded
          ? (Array.isArray(res.result.stats) ? res.result.stats : [])
          : this.data.stats;
        const activeLessonId = String(this.data.selectedLessonId || this.data.lessonId || "").trim();
        const currentStats = historyIncluded
          ? (res.result.currentStats ||
            nextStats.find(item => String(item.lessonId || "").trim() === activeLessonId) || null)
          : (activeLessonId === lessonId
            ? (res.result.currentStats || this.data.currentStats || null)
            : this.data.currentStats || null);

        if (historyIncluded) {
          this.historyStatsLoadedClassId = classId;
        }

        const nextState = historyIncluded
          ? {
            stats: nextStats,
            currentStats
          }
          : (activeLessonId === lessonId
            ? { currentStats }
            : null);

        if (nextState && !(activeLessonId === lessonId && this.shouldSkipPostSwitchStatsPatch(lessonId, currentStats))) {
          this.setData(nextState);
        }
        this.refreshExportDisabledState();
        return currentStats;
      } else {
        if (includeHistory) {
          this.historyStatsLoadedClassId = "";
        }
        const activeLessonId = String(this.data.selectedLessonId || this.data.lessonId || "").trim();
        const nextState = includeHistory
          ? {
            stats: [],
            currentStats: null
          }
          : null;
        if (nextState) {
          this.setData(nextState);
          this.refreshExportDisabledState();
        }
        return null;
      }
      } catch (err) {
      console.error("[signRecord] loadStats failed", err);
      if (includeHistory) {
        this.historyStatsLoadedClassId = "";
      }
      const activeLessonId = String(this.data.selectedLessonId || this.data.lessonId || "").trim();
      const nextState = includeHistory
        ? {
          stats: [],
          currentStats: null
        }
        : null;
      if (nextState) {
        this.setData(nextState);
        this.refreshExportDisabledState();
      }
      return null;
      } finally {
        if (this.statsRequestPromise === requestPromise) {
          this.statsRequestPromise = null;
          this.statsRequestKey = "";
          this.setData({ statsLoading: false });
          this.refreshExportDisabledState();
        }
      }
    })();

    this.statsRequestKey = requestKey;
    this.statsRequestPromise = requestPromise;
    return requestPromise;
  },

  escapeCsv(value) {
    const text = String(value ?? "");
    if (!/[",\n\r]/.test(text)) return text;
    return `"${text.replace(/"/g, '""')}"`;
  },

  copyCsvToClipboard(csvText, successTitle) {
    wx.setClipboardData({
      data: `\uFEFF${csvText}`,
      success: () => {
        wx.showToast({
          title: successTitle,
          icon: "none"
        });
      },
      fail: (err) => {
        console.error("[signRecord] copy csv failed", err);
        wx.showToast({
          title: "导出失败，请稍后重试",
          icon: "none"
        });
      }
    });
  },

  getAttendanceStatusLabel(status = "") {
    return this.getSignStatusLabel(String(status || "").trim() || "unsigned");
  },

  getLeaveRequestStatusLabel(status = "") {
    const normalizedStatus = String(status || "").trim() || "pending";
    const map = {
      pending: "待处理",
      approved: "已确认",
      closed: "已关闭"
    };
    return map[normalizedStatus] || "待处理";
  },

  getCurrentLessonId() {
    const lessons = Array.isArray(this.data.lessons) ? this.data.lessons : [];
    return String(lessons[0]?._id || "").trim();
  },

  isSelectedCurrentLesson(targetLessonId = "") {
    const selectedLessonId = String(
      targetLessonId ||
      this.data.selectedLessonId ||
      this.data.lessonId ||
      ""
    ).trim();
    const currentLessonId = this.getCurrentLessonId();
    return !!selectedLessonId && !!currentLessonId && selectedLessonId === currentLessonId;
  },

  canOperateAttendanceStatus(item = {}, options = {}) {
    const lessonId = String(
      options.lessonId ||
      this.data.selectedLessonId ||
      this.data.lessonId ||
      ""
    ).trim();
    if (!this.isSelectedCurrentLesson(lessonId)) return false;
    const status = String(item.status || "").trim() || "unsigned";
    return status === "unsigned" || status === "leave_agree" || status === "absent";
  },

  canEditAttendanceForAction(student = {}, nextStatus = "", options = {}) {
    const lessonId = String(
      options.lessonId ||
      this.data.selectedLessonId ||
      this.data.lessonId ||
      ""
    ).trim();
    const status = String(nextStatus || "").trim();
    if (!lessonId || !status) return false;
    return this.canOperateAttendanceStatus(student, { lessonId });
  },

  getMatchedAttendanceDoc(student = {}) {
    const studentId = String(student.studentId || "").trim();
    const studentName = String(student.name || student.studentName || "").trim();
    const attendanceDocs = Array.isArray(this.latestAttendanceDocs) ? this.latestAttendanceDocs : [];

    return attendanceDocs.find((doc) => {
      const docStudentId = String(doc.studentId || "").trim();
      const docStudentName = String(doc.studentName || "").trim();

      if (studentId && docStudentId) {
        return docStudentId === studentId;
      }

      return !!studentName && docStudentName === studentName;
    }) || null;
  },

  async saveAttendanceStatus(student = {}, nextStatus = "") {
    const lessonId = String(this.data.selectedLessonId || this.data.lessonId || "").trim();
    const classId = String(this.data.classId || "").trim();
    const studentId = String(student.studentId || "").trim();
    const studentName = String(student.name || student.studentName || "").trim();
    const status = String(nextStatus || "").trim();

    if (!lessonId || !classId || !studentName || !status) {
      wx.showToast({
        title: "缺少状态信息",
        icon: "none"
      });
      return false;
    }

    if (!this.canEditAttendanceForAction({
      studentId,
      name: studentName,
      status: String(student.status || "").trim() || "unsigned"
    }, status, { lessonId })) {
      wx.showToast({
        title: "历史课次不可修改考勤",
        icon: "none"
      });
      return false;
    }

    try {
      const existed = this.getMatchedAttendanceDoc({ studentId, name: studentName });
      const payload = {
        lessonId,
        classId,
        studentId,
        studentName,
        status,
        attendanceStatus: status,
        updatedAt: db.serverDate()
      };

      if (existed && existed._id) {
        await db.collection("attendance").doc(existed._id).update({
          data: payload
        });
      } else {
        await db.collection("attendance").add({
          data: payload
        });
      }

      await this.fetchAttendanceOnce(lessonId);
      return true;
    } catch (err) {
      console.error("[signRecord] saveAttendanceStatus failed", err);
      wx.showToast({
        title: "状态更新失败，请稍后重试",
        icon: "none"
      });
      return false;
    }
  },

  refreshExportDisabledState() {
    const nextState = this.buildExportDisabledState();
    if (
      this.data.detailExportDisabled !== nextState.detailExportDisabled ||
      this.data.statsExportDisabled !== nextState.statsExportDisabled
    ) {
      this.setData(nextState);
    }
  },

  refreshSignedStudents() {
    const list = Array.isArray(this.data.list) ? this.data.list : [];
    const signedStudents = this.getSignedStudentsFromList(list);
    if (JSON.stringify(this.data.signedStudents || []) !== JSON.stringify(signedStudents)) {
      this.setData({ signedStudents });
    }
    return signedStudents;
  },

  getRandomSignedStudent() {
    const signedStudents = Array.isArray(this.data.signedStudents) ? this.data.signedStudents : [];
    if (signedStudents.length === 0) return null;
    const index = Math.floor(Math.random() * signedStudents.length);
    return signedStudents[index] || null;
  },

  getStudentUniqueId(student = {}) {
    return String(
      student.studentId ||
      student.id ||
      student.openid ||
      student._openid ||
      student.name ||
      ""
    ).trim();
  },

  getLessonEventTargetStudentKey(item = {}) {
    const type = String(item.type || "").trim();
    if (type === "leave_request") {
      return String(
        item.leaveRequestedStudentId ||
        item.leaveRequestedStudentName ||
        this.getStudentUniqueId(item)
      ).trim();
    }

    return this.getStudentUniqueId(item);
  },

  getAffectedLessonEventStudentKeys(lessonEvents = [], previousLessonEvents = []) {
    const studentKeys = new Set();
    [...(previousLessonEvents || []), ...(lessonEvents || [])].forEach((item) => {
      const studentKey = this.getLessonEventTargetStudentKey(item);
      if (studentKey) {
        studentKeys.add(studentKey);
      }
    });
    return Array.from(studentKeys);
  },

  getListRowIndexMap(list = this.data.list) {
    this.ensureRuntimeCaches();
    const currentList = Array.isArray(list) ? list : [];
    if (currentList.length === 0) return null;

    if (
      this.listRowIndexSource === currentList &&
      this.listRowIndexByStudentKey instanceof Map &&
      this.listRowIndexByStudentKey.size > 0
    ) {
      return this.listRowIndexByStudentKey;
    }

    const rowIndexMap = new Map();
    currentList.forEach((item, index) => {
      const studentKey = this.getStudentUniqueId(item);
      if (!studentKey) return;
      rowIndexMap.set(studentKey, index);
    });

    this.listRowIndexSource = currentList;
    this.listRowIndexByStudentKey = rowIndexMap;
    return rowIndexMap;
  },

  getWeightedCandidates(candidateList = []) {
    return candidateList;
  },

  getLessonEventTypeLabel(type) {
    const map = {
      rollcall: "随机点名",
      answer_score: "回答得分",
      student_question: "主动提问",
      leave_request: "请假申请",
      test_publish: "测试发布",
      test_record: "随堂测试",
      question_request: "提问申请",
      question_approved: "允许提问",
      question_score: "提问得分"
    };
    return map[type] || type;
  },

  getQuestionRequestId(item = {}) {
    return String(
      item?.payload?.requestId ||
      (item.type === "question_request" ? item._id : "") ||
      ""
    ).trim();
  },

  getLessonEventsSignature(lessonEvents = []) {
    return JSON.stringify(
      (lessonEvents || []).map((item) => ({
        _id: String(item._id || ""),
        type: String(item.type || ""),
        studentId: String(item.studentId || ""),
        studentName: String(item.studentName || ""),
        score: item.score ?? "",
        round: Number(item.round || 0),
        requestId: this.getQuestionRequestId(item),
        displayTime: String(item.displayTime || "")
      }))
    );
  },

  getAttendanceDocsSignature(docs = []) {
    return JSON.stringify(
      (docs || []).map((item) => ({
        _id: String(item._id || ""),
        studentId: String(item.studentId || ""),
        studentName: String(item.studentName || ""),
        status: String(item.status || item.attendanceStatus || ""),
        attendanceStatus: String(item.attendanceStatus || ""),
        updatedAt: String(item.updatedAt || "")
      }))
    );
  },

  getAttendanceDocComparableSignature(doc = null) {
    if (!doc) return "";
    return JSON.stringify({
      _id: String(doc._id || ""),
      studentId: String(doc.studentId || ""),
      studentName: String(doc.studentName || ""),
      status: String(doc.status || doc.attendanceStatus || ""),
      attendanceStatus: String(doc.attendanceStatus || ""),
      updatedAt: String(doc.updatedAt || "")
    });
  },

  buildAttendanceDocMap(attendanceDocs = [], list = this.data.list) {
    const docsByStudentId = new Map();
    const docsByStudentName = new Map();

    (attendanceDocs || []).forEach((doc) => {
      const studentId = String(doc.studentId || "").trim();
      const studentName = String(doc.studentName || "").trim();
      if (studentId) docsByStudentId.set(studentId, doc);
      if (studentName) docsByStudentName.set(studentName, doc);
    });

    const attendanceDocMap = new Map();
    const currentList = Array.isArray(list) ? list : [];

    currentList.forEach((item) => {
      const studentKey = this.getStudentUniqueId(item);
      if (!studentKey) return;
      const studentId = String(item.studentId || "").trim();
      const studentName = String(item.name || item.studentName || "").trim();
      const matchedDoc =
        (studentId && docsByStudentId.get(studentId)) ||
        (studentName && docsByStudentName.get(studentName)) ||
        null;
      attendanceDocMap.set(studentKey, matchedDoc);
    });

    (attendanceDocs || []).forEach((doc) => {
      const fallbackKey = String(doc.studentId || doc.studentName || "").trim();
      if (fallbackKey && !attendanceDocMap.has(fallbackKey)) {
        attendanceDocMap.set(fallbackKey, doc);
      }
    });

    return attendanceDocMap;
  },

  collectChangedAttendanceStudentIds(prevMap = new Map(), nextMap = new Map()) {
    const changedStudentKeys = new Set();
    const allKeys = new Set([
      ...Array.from(prevMap.keys()),
      ...Array.from(nextMap.keys())
    ]);

    allKeys.forEach((studentKey) => {
      const prevDoc = prevMap.get(studentKey) || null;
      const nextDoc = nextMap.get(studentKey) || null;
      if (this.getAttendanceDocComparableSignature(prevDoc) !== this.getAttendanceDocComparableSignature(nextDoc)) {
        changedStudentKeys.add(studentKey);
      }
    });

    return Array.from(changedStudentKeys);
  },

  isFreshCache(cacheItem = null, maxAge = 0) {
    if (!cacheItem || !cacheItem.fetchedAt || !maxAge) return false;
    return (Date.now() - Number(cacheItem.fetchedAt || 0)) < maxAge;
  },

  getFreshAttendanceCache(lessonId = "", maxAge = 2500) {
    this.ensureRuntimeCaches();
    const targetLessonId = String(lessonId || "").trim();
    if (!targetLessonId || !(this.attendanceCacheByLesson instanceof Map)) return null;
    const cacheItem = this.attendanceCacheByLesson.get(targetLessonId) || null;
    return this.isFreshCache(cacheItem, maxAge) ? cacheItem : null;
  },

  getFreshLessonEventCache(lessonId = "", maxAge = 4500) {
    this.ensureRuntimeCaches();
    const targetLessonId = String(lessonId || "").trim();
    if (!targetLessonId || !(this.lessonEventCacheByLesson instanceof Map)) return null;
    const cacheItem = this.lessonEventCacheByLesson.get(targetLessonId) || null;
    return this.isFreshCache(cacheItem, maxAge) ? cacheItem : null;
  },

  getQuestionStateSignature(pendingQuestionRequests = [], currentQuestionRequest = null) {
    return JSON.stringify({
      pendingQuestionRequests: (pendingQuestionRequests || []).map((item) => ({
        _id: String(item._id || ""),
        studentId: String(item.studentId || ""),
        studentName: String(item.studentName || ""),
        requestId: this.getQuestionRequestId(item)
      })),
      currentQuestionRequest: currentQuestionRequest
        ? {
          _id: String(currentQuestionRequest._id || ""),
          studentId: String(currentQuestionRequest.studentId || ""),
          studentName: String(currentQuestionRequest.studentName || ""),
          requestId: this.getQuestionRequestId(currentQuestionRequest)
        }
        : null
    });
  },

  getLeaveRequestStateSignature(pendingLeaveRequests = []) {
    return JSON.stringify(
      (pendingLeaveRequests || []).map((item) => ({
        _id: String(item._id || ""),
        studentId: String(item.studentId || ""),
        studentName: String(item.studentName || ""),
        applicantStudentName: String(item.leaveApplicantStudentName || ""),
        imageFileId: String(item.leaveRequestImageFileId || ""),
        leaveRequestStatus: String(item.leaveRequestStatus || "")
      }))
    );
  },

  getLatestLeaveRequestByStudent(student = {}) {
    const studentId = String(student.studentId || "").trim();
    const studentName = String(student.studentName || student.name || "").trim();
    const lessonEvents = Array.isArray(this.data.lessonEvents) ? this.data.lessonEvents : [];

    const matchedEvents = lessonEvents.filter((item) => {
      if (item.type !== "leave_request") return false;
      const itemStudentId = String(item.studentId || "").trim();
      const itemStudentName = String(item.studentName || "").trim();
      if (studentId && itemStudentId) {
        return itemStudentId === studentId;
      }
      return !!studentName && itemStudentName === studentName;
    });

    return matchedEvents.sort((a, b) => this.getEventTimestamp(b) - this.getEventTimestamp(a))[0] || null;
  },

  getAttendanceListSignature(list = []) {
    return JSON.stringify(
      (list || []).map((item) => ({
        studentId: String(item.studentId || item.id || "").trim(),
        name: String(item.name || item.studentName || "").trim(),
        status: String(item.status || "").trim(),
        statusLabel: String(item.statusLabel || "").trim(),
        hasPendingLeaveRequest: !!item.hasPendingLeaveRequest,
        pendingLeaveApplicantName: String(item.pendingLeaveApplicantName || "").trim(),
        attendanceScoreText: String(item.attendanceScoreText || "").trim(),
        answerScoreText: String(item.answerScoreText || "").trim(),
        answerScoreAvgText: String(item.answerScoreAvgText || "").trim(),
        questionScoreText: String(item.questionScoreText || "").trim(),
        questionScoreAvgText: String(item.questionScoreAvgText || "").trim(),
        testScoreText: String(item.testScoreText || "").trim(),
        testScoreAvgText: String(item.testScoreAvgText || "").trim(),
        lessonScoreText: String(item.lessonScoreText || "").trim(),
        lessonScoreBreakdownText: String(item.lessonScoreBreakdownText || "").trim()
      }))
    );
  },

  getSignedStudentsFromList(list = []) {
    return (list || [])
      .filter((item) => item.status === "signed")
      .map((item) => ({
        studentId: String(item.studentId || item.id || "").trim(),
        name: String(item.name || item.studentName || "").trim()
      }))
      .filter((item) => item.name);
  },

  getCurrentStatsSignature(currentStats = null) {
    if (!currentStats) return "";
    return JSON.stringify({
      lessonId: String(currentStats.lessonId || "").trim(),
      rosterCount: Number(currentStats.rosterCount || 0),
      signedCount: Number(currentStats.signedCount || 0),
      unsignedCount: Number(currentStats.unsignedCount || 0),
      absentCount: Number(currentStats.absentCount || 0),
      leaveWaitCount: Number(currentStats.leaveWaitCount || 0),
      leaveAgreeCount: Number(currentStats.leaveAgreeCount || 0)
    });
  },

  registerPostSwitchSnapshot(options = {}) {
    this.ensureRuntimeCaches();
    const lessonId = String(options.lessonId || "").trim();
    if (!lessonId) {
      this.postSwitchSnapshot = null;
      return;
    }

    this.postSwitchSnapshot = {
      lessonId,
      landed: true,
      attendanceSignature: typeof options.attendanceSignature === "string"
        ? options.attendanceSignature
        : null,
      lessonEventsSignature: typeof options.lessonEventsSignature === "string"
        ? options.lessonEventsSignature
        : null,
      statsSignature: typeof options.statsSignature === "string"
        ? options.statsSignature
        : null,
      attendanceConsumed: false,
      lessonEventsConsumed: false,
      statsConsumed: false
    };
  },

  shouldSkipPostSwitchAttendancePatch(lessonId = "", attendanceSignature = "") {
    this.ensureRuntimeCaches();
    const snapshot = this.postSwitchSnapshot;
    const targetLessonId = String(lessonId || "").trim();
    if (!snapshot || snapshot.lessonId !== targetLessonId || !snapshot.landed || snapshot.attendanceConsumed) {
      return false;
    }

    snapshot.attendanceConsumed = true;
    if (typeof snapshot.attendanceSignature !== "string") {
      return false;
    }

    return snapshot.attendanceSignature === String(attendanceSignature || "");
  },

  shouldSkipPostSwitchLessonEventPatch(lessonId = "", lessonEventsSignature = "") {
    this.ensureRuntimeCaches();
    const snapshot = this.postSwitchSnapshot;
    const targetLessonId = String(lessonId || "").trim();
    if (!snapshot || snapshot.lessonId !== targetLessonId || !snapshot.landed || snapshot.lessonEventsConsumed) {
      return false;
    }

    snapshot.lessonEventsConsumed = true;
    if (typeof snapshot.lessonEventsSignature !== "string") {
      return false;
    }

    return snapshot.lessonEventsSignature === String(lessonEventsSignature || "");
  },

  shouldSkipPostSwitchStatsPatch(lessonId = "", currentStats = null) {
    this.ensureRuntimeCaches();
    const snapshot = this.postSwitchSnapshot;
    const targetLessonId = String(lessonId || "").trim();
    if (!snapshot || snapshot.lessonId !== targetLessonId || !snapshot.landed || snapshot.statsConsumed) {
      return false;
    }

    snapshot.statsConsumed = true;
    if (typeof snapshot.statsSignature !== "string") {
      return false;
    }

    return snapshot.statsSignature === this.getCurrentStatsSignature(currentStats);
  },

  buildDerivedStatsFromList(list = [], currentStatsInput = this.data.currentStats) {
    const signCount = list.filter((i) => i.status === "signed").length;
    const unsignCount = list.filter((i) => i.status === "unsigned").length;
    const absentCount = list.filter((i) => i.status === "absent").length;
    const waitCount = list.filter((i) => i.status === "leave_wait").length;
    const leaveCount = list.filter((i) => i.status === "leave_agree").length;
    const currentStatsBase = currentStatsInput || (list.length > 0
      ? {
        lessonId: String(this.data.selectedLessonId || this.data.lessonId || "").trim(),
        rosterCount: list.length
      }
      : null);
    const currentStats = currentStatsBase
      ? {
        ...currentStatsBase,
        lessonId: String(
          currentStatsBase.lessonId ||
          this.data.selectedLessonId ||
          this.data.lessonId ||
          ""
        ).trim(),
        rosterCount: Number(currentStatsBase.rosterCount || list.length || 0),
        signedCount: signCount,
        unsignedCount: unsignCount,
        absentCount,
        leaveWaitCount: waitCount,
        leaveAgreeCount: leaveCount
      }
      : null;

    return {
      signCount,
      unsignCount,
      absentCount,
      waitCount,
      leaveCount,
      currentStats
    };
  },

  buildListMetaPatch(list = [], options = {}) {
    const lessonId = String(
      options.lessonId ||
      this.data.selectedLessonId ||
      this.data.lessonId ||
      ""
    ).trim();
    const currentStatsInput = Object.prototype.hasOwnProperty.call(options, "currentStats")
      ? options.currentStats
      : this.data.currentStats;
    const exportDisabledState = this.buildExportDisabledState({
      list,
      stats: options.stats ?? this.data.stats,
      lessonsLoading: options.lessonsLoading,
      statsLoading: options.statsLoading
    });

    return {
      isCurrentLessonSelected: this.isSelectedCurrentLesson(lessonId),
      signedStudents: this.getSignedStudentsFromList(list),
      ...exportDisabledState,
      ...this.buildDerivedStatsFromList(list, currentStatsInput)
    };
  },

  buildExportDisabledState(options = {}) {
    const lessonsLoading = options.lessonsLoading ?? this.data.lessonsLoading;
    const statsLoading = options.statsLoading ?? this.data.statsLoading;
    const list = options.list ?? this.data.list;
    const stats = options.stats ?? this.data.stats;
    const isListInvalid = !Array.isArray(list) || list.length === 0;
    const isStatsInvalid = !Array.isArray(stats) || stats.length === 0;

    return {
      detailExportDisabled: Boolean(lessonsLoading || statsLoading || isListInvalid),
      statsExportDisabled: Boolean(lessonsLoading || statsLoading || isStatsInvalid)
    };
  },

  buildListViewPatch(list = [], options = {}) {
    return {
      list,
      ...this.buildListMetaPatch(list, options)
    };
  },

  buildLessonDisplayList(baseList = [], attendanceDocs = [], lessonEvents = [], options = {}) {
    const lessonId = String(
      options.lessonId ||
      this.data.selectedLessonId ||
      this.data.lessonId ||
      ""
    ).trim();
    const attendanceMergedList = this.mergeAttendanceIntoList(baseList, attendanceDocs);
    return this.mergeInteractionIntoList(attendanceMergedList, lessonEvents).map((item) => ({
      ...item,
      canOperateAttendanceStatus: this.canOperateAttendanceStatus(item, { lessonId })
    }));
  },

  getLessonEventDerivedRowSignature(item = {}) {
    return JSON.stringify({
      answerScoreText: String(item.answerScoreText || ""),
      answerScoreAvg: Number.isFinite(item.answerScoreAvg) ? item.answerScoreAvg : null,
      answerScoreAvgText: String(item.answerScoreAvgText || ""),
      questionScoreText: String(item.questionScoreText || ""),
      questionScoreAvg: Number.isFinite(item.questionScoreAvg) ? item.questionScoreAvg : null,
      questionScoreAvgText: String(item.questionScoreAvgText || ""),
      testScoreText: String(item.testScoreText || ""),
      testScoreAvg: Number.isFinite(item.testScoreAvg) ? item.testScoreAvg : null,
      testScoreAvgText: String(item.testScoreAvgText || ""),
      hasPendingLeaveRequest: !!item.hasPendingLeaveRequest,
      pendingLeaveApplicantName: String(item.pendingLeaveApplicantName || ""),
      attendanceScore: Number.isFinite(item.attendanceScore) ? item.attendanceScore : null,
      attendanceScoreText: String(item.attendanceScoreText || ""),
      lessonScore: Number.isFinite(item.lessonScore) ? item.lessonScore : null,
      lessonScoreText: String(item.lessonScoreText || ""),
      lessonScoreBreakdownText: String(item.lessonScoreBreakdownText || "")
    });
  },

  buildLessonEventRowPatches(lessonEvents = []) {
    const currentList = Array.isArray(this.data.list) ? this.data.list : [];
    if (currentList.length === 0) {
      return {
        shouldFallback: true,
        nextList: []
      };
    }

    const affectedStudentKeys = this.getAffectedLessonEventStudentKeys(
      lessonEvents,
      this.data.lessonEvents
    );
    if (affectedStudentKeys.length === 0) {
      return {
        shouldFallback: false,
        patches: {}
      };
    }

    const rowIndexMap = this.getListRowIndexMap(currentList);
    if (!(rowIndexMap instanceof Map) || rowIndexMap.size === 0) {
      return {
        shouldFallback: true,
        nextList: []
      };
    }

    const derivedMap = this.buildLessonEventDerivedMap(lessonEvents);
    const patches = {};
    let shouldFallback = false;

    affectedStudentKeys.forEach((studentKey) => {
      if (shouldFallback) return;

      const index = rowIndexMap.get(studentKey);
      if (!Number.isInteger(index)) {
        shouldFallback = true;
        return;
      }

      const currentItem = currentList[index] || {};
      if (this.getStudentUniqueId(currentItem) !== studentKey) {
        shouldFallback = true;
        return;
      }

      const nextDerivedFields = this.buildInteractionDerivedFieldsForRow(currentItem, derivedMap);
      const nextItem = {
        ...currentItem,
        ...nextDerivedFields
      };

      if (this.getLessonEventDerivedRowSignature(nextItem) === this.getLessonEventDerivedRowSignature(currentItem)) {
        return;
      }

      patches[`list[${index}].answerScoreText`] = nextDerivedFields.answerScoreText;
      patches[`list[${index}].answerScoreAvg`] = nextDerivedFields.answerScoreAvg ?? null;
      patches[`list[${index}].answerScoreAvgText`] = nextDerivedFields.answerScoreAvgText;
      patches[`list[${index}].questionScoreText`] = nextDerivedFields.questionScoreText;
      patches[`list[${index}].questionScoreAvg`] = nextDerivedFields.questionScoreAvg ?? null;
      patches[`list[${index}].questionScoreAvgText`] = nextDerivedFields.questionScoreAvgText;
      patches[`list[${index}].testScoreText`] = nextDerivedFields.testScoreText;
      patches[`list[${index}].testScoreAvg`] = nextDerivedFields.testScoreAvg ?? null;
      patches[`list[${index}].testScoreAvgText`] = nextDerivedFields.testScoreAvgText;
      patches[`list[${index}].hasPendingLeaveRequest`] = !!nextDerivedFields.hasPendingLeaveRequest;
      patches[`list[${index}].pendingLeaveApplicantName`] = nextDerivedFields.pendingLeaveApplicantName || "";
      patches[`list[${index}].attendanceScore`] = nextDerivedFields.attendanceScore ?? null;
      patches[`list[${index}].attendanceScoreText`] = nextDerivedFields.attendanceScoreText || "";
      patches[`list[${index}].lessonScore`] = nextDerivedFields.lessonScore ?? null;
      patches[`list[${index}].lessonScoreText`] = nextDerivedFields.lessonScoreText || "";
      patches[`list[${index}].lessonScoreBreakdownText`] = nextDerivedFields.lessonScoreBreakdownText || "";
      patches[`list[${index}].lessonScoreApplicableItems`] = Array.isArray(nextDerivedFields.lessonScoreApplicableItems)
        ? nextDerivedFields.lessonScoreApplicableItems
        : [];
    });

    if (shouldFallback) {
      return {
        shouldFallback: true,
        nextList: []
      };
    }

    return {
      shouldFallback: false,
      patches
    };
  },

  getAttendanceDerivedRowSignature(item = {}) {
    return JSON.stringify({
      status: String(item.status || "").trim(),
      statusLabel: String(item.statusLabel || "").trim(),
      canOperateAttendanceStatus: !!item.canOperateAttendanceStatus,
      attendanceScore: Number.isFinite(item.attendanceScore) ? item.attendanceScore : null,
      attendanceScoreText: String(item.attendanceScoreText || "").trim(),
      lessonScore: Number.isFinite(item.lessonScore) ? item.lessonScore : null,
      lessonScoreText: String(item.lessonScoreText || "").trim(),
      lessonScoreBreakdownText: String(item.lessonScoreBreakdownText || "").trim(),
      lessonScoreApplicableItems: Array.isArray(item.lessonScoreApplicableItems)
        ? item.lessonScoreApplicableItems.map((child) => ({
          key: String(child?.key || ""),
          label: String(child?.label || ""),
          score: Number.isFinite(child?.score) ? child.score : null
        }))
        : []
    });
  },

  buildAttendanceDerivedFieldsForRow(row = {}, attendanceDoc = null, options = {}) {
    const lessonId = String(
      options.lessonId ||
      this.data.selectedLessonId ||
      this.data.lessonId ||
      ""
    ).trim();
    const nextStatus = attendanceDoc
      ? String(
        attendanceDoc.status ||
        attendanceDoc.attendanceStatus ||
        "signed"
      ).trim() || "signed"
      : "unsigned";
    const lessonScoreDetail = this.buildLessonScoreDetail(nextStatus, {
      answerScoreAvg: Number.isFinite(row.answerScoreAvg) ? row.answerScoreAvg : null,
      questionScoreAvg: Number.isFinite(row.questionScoreAvg) ? row.questionScoreAvg : null,
      testScoreAvg: Number.isFinite(row.testScoreAvg) ? row.testScoreAvg : null
    });
    const nextRow = {
      ...row,
      status: nextStatus
    };

    return {
      status: nextStatus,
      statusLabel: this.getAttendanceStatusLabel(nextStatus),
      canOperateAttendanceStatus: this.canOperateAttendanceStatus(nextRow, { lessonId }),
      attendanceScore: lessonScoreDetail.attendanceScore,
      attendanceScoreText: lessonScoreDetail.attendanceScoreText,
      lessonScore: lessonScoreDetail.lessonScore,
      lessonScoreText: lessonScoreDetail.lessonScoreText,
      lessonScoreBreakdownText: lessonScoreDetail.lessonScoreBreakdownText,
      lessonScoreApplicableItems: lessonScoreDetail.lessonScoreApplicableItems
    };
  },

  shouldFallbackToFullRebuild(options = {}) {
    const lessonId = String(options.lessonId || "").trim();
    const currentList = Array.isArray(options.currentList) ? options.currentList : [];
    const rowIndexMap = options.rowIndexMap;
    const changedStudentKeys = Array.isArray(options.changedStudentKeys) ? options.changedStudentKeys : [];
    const missingStudentKeys = Number(options.missingStudentKeys || 0);
    const baseRosterList = Array.isArray(options.baseRosterList)
      ? options.baseRosterList
      : (Array.isArray(this.data.baseRosterList) ? this.data.baseRosterList : []);

    if (!lessonId || !this.isLessonActive(lessonId)) return true;
    if (currentList.length === 0) return true;
    if (!(rowIndexMap instanceof Map) || rowIndexMap.size === 0) return true;
    if (baseRosterList.length > 0 && currentList.length !== baseRosterList.length) return true;
    if (missingStudentKeys > 0) return true;

    const fullRebuildThreshold = Math.max(40, Math.floor(currentList.length * 0.4));
    if (changedStudentKeys.length >= fullRebuildThreshold) return true;

    return false;
  },

  buildAttendanceRowPatches(changedStudentKeys = [], options = {}) {
    const lessonId = String(
      options.lessonId ||
      this.data.selectedLessonId ||
      this.data.lessonId ||
      ""
    ).trim();
    const currentList = Array.isArray(this.data.list) ? this.data.list : [];
    const rowIndexMap = this.getListRowIndexMap(currentList);
    const nextAttendanceDocMap = options.nextAttendanceDocMap instanceof Map
      ? options.nextAttendanceDocMap
      : this.buildAttendanceDocMap(options.attendanceDocs || [], currentList);

    if (this.shouldFallbackToFullRebuild({
      lessonId,
      currentList,
      rowIndexMap,
      changedStudentKeys
    })) {
      return {
        shouldFallback: true,
        patches: {},
        nextList: currentList
      };
    }

    const patches = {};
    const nextList = currentList.slice();
    let missingStudentKeys = 0;

    changedStudentKeys.forEach((studentKey) => {
      const index = rowIndexMap.get(studentKey);
      if (!Number.isInteger(index)) {
        missingStudentKeys += 1;
        return;
      }

      const currentRow = currentList[index] || {};
      if (this.getStudentUniqueId(currentRow) !== studentKey) {
        missingStudentKeys += 1;
        return;
      }

      const nextDerivedFields = this.buildAttendanceDerivedFieldsForRow(
        currentRow,
        nextAttendanceDocMap.get(studentKey) || null,
        { lessonId }
      );
      const nextRow = {
        ...currentRow,
        ...nextDerivedFields
      };

      nextList[index] = nextRow;

      if (this.getAttendanceDerivedRowSignature(nextRow) === this.getAttendanceDerivedRowSignature(currentRow)) {
        return;
      }

      patches[`list[${index}].status`] = nextDerivedFields.status;
      patches[`list[${index}].statusLabel`] = nextDerivedFields.statusLabel;
      patches[`list[${index}].canOperateAttendanceStatus`] = !!nextDerivedFields.canOperateAttendanceStatus;
      patches[`list[${index}].attendanceScore`] = nextDerivedFields.attendanceScore ?? null;
      patches[`list[${index}].attendanceScoreText`] = nextDerivedFields.attendanceScoreText || "";
      patches[`list[${index}].lessonScore`] = nextDerivedFields.lessonScore ?? null;
      patches[`list[${index}].lessonScoreText`] = nextDerivedFields.lessonScoreText || "";
      patches[`list[${index}].lessonScoreBreakdownText`] = nextDerivedFields.lessonScoreBreakdownText || "";
      patches[`list[${index}].lessonScoreApplicableItems`] = Array.isArray(nextDerivedFields.lessonScoreApplicableItems)
        ? nextDerivedFields.lessonScoreApplicableItems
        : [];
    });

    if (this.shouldFallbackToFullRebuild({
      lessonId,
      currentList,
      rowIndexMap,
      changedStudentKeys,
      missingStudentKeys
    })) {
      return {
        shouldFallback: true,
        patches: {},
        nextList: currentList
      };
    }

    return {
      shouldFallback: false,
      patches,
      nextList
    };
  },

  parseScore(value) {
    if (value === "" || value === null || typeof value === "undefined") {
      return null;
    }

    const score = Number(value);
    return Number.isFinite(score) ? score : null;
  },

  formatScore(value) {
    if (!Number.isFinite(value)) return "";
    const fixedScore = Math.round(value * 100) / 100;
    return Number.isInteger(fixedScore)
      ? String(fixedScore)
      : fixedScore.toFixed(2).replace(/\.?0+$/, "");
  },

  getAverageScore(scoreList = []) {
    const validScores = (scoreList || []).filter((score) => Number.isFinite(score));
    if (validScores.length === 0) return null;
    const total = validScores.reduce((sum, score) => sum + score, 0);
    return Math.round((total / validScores.length) * 100) / 100;
  },

  buildLessonScoreDetail(status = "", options = {}) {
    const normalizedStatus = String(status || "").trim();
    const answerScoreAvg = Number.isFinite(options.answerScoreAvg) ? options.answerScoreAvg : null;
    const questionScoreAvg = Number.isFinite(options.questionScoreAvg) ? options.questionScoreAvg : null;
    const testScoreAvg = Number.isFinite(options.testScoreAvg) ? options.testScoreAvg : null;

    if (normalizedStatus === "leave_agree") {
      return {
        attendanceScore: 60,
        attendanceScoreText: "60",
        lessonScore: 60,
        lessonScoreText: "60",
        lessonScoreBreakdownText: "请假60",
        lessonScoreApplicableItems: [
          { key: "attendance_leave", label: "请假", score: 60 }
        ]
      };
    }

    if (normalizedStatus === "absent") {
      return {
        attendanceScore: 0,
        attendanceScoreText: "0",
        lessonScore: 0,
        lessonScoreText: "0",
        lessonScoreBreakdownText: "旷课0",
        lessonScoreApplicableItems: [
          { key: "attendance_absent", label: "旷课", score: 0 }
        ]
      };
    }

    const applicableItems = [];
    if (normalizedStatus === "signed") {
      applicableItems.push({
        key: "attendance_present",
        label: "到课",
        score: 80
      });
    }
    if (Number.isFinite(answerScoreAvg)) {
      applicableItems.push({
        key: "rollcall",
        label: "随机点名",
        score: answerScoreAvg
      });
    }
    if (Number.isFinite(questionScoreAvg)) {
      applicableItems.push({
        key: "question",
        label: "主动提问",
        score: questionScoreAvg
      });
    }
    if (Number.isFinite(testScoreAvg)) {
      applicableItems.push({
        key: "test",
        label: "随堂测试",
        score: testScoreAvg
      });
    }

    if (applicableItems.length === 0) {
      return {
        attendanceScore: normalizedStatus === "signed" ? 80 : null,
        attendanceScoreText: normalizedStatus === "signed" ? "80" : "",
        lessonScore: null,
        lessonScoreText: "",
        lessonScoreBreakdownText: "",
        lessonScoreApplicableItems: []
      };
    }

    const lessonScore = this.getAverageScore(applicableItems.map((item) => item.score));

    return {
      attendanceScore: normalizedStatus === "signed" ? 80 : null,
      attendanceScoreText: normalizedStatus === "signed" ? "80" : "",
      lessonScore,
      lessonScoreText: this.formatScore(lessonScore),
      lessonScoreBreakdownText: applicableItems
        .map((item) => `${item.label}${this.formatScore(item.score)}`)
        .join(" / "),
      lessonScoreApplicableItems: applicableItems
    };
  },

  buildInteractionScoreMap(lessonEvents = []) {
    const interactionScoreMap = new Map();
    const scoreEvents = (lessonEvents || []).filter(
      (item) =>
        item.type === "answer_score" ||
        item.type === "question_score" ||
        item.type === "test_record"
    );

    scoreEvents.forEach((item) => {
      const studentKey = this.getStudentUniqueId(item);
      if (!studentKey) return;

      if (!interactionScoreMap.has(studentKey)) {
        interactionScoreMap.set(studentKey, {
          answerScores: [],
          questionScores: [],
          testScores: []
        });
      }

      const score = this.parseScore(item.score);
      if (!Number.isFinite(score)) return;

      const target = interactionScoreMap.get(studentKey);
      if (item.type === "answer_score") {
        target.answerScores.push(score);
        return;
      }

      if (item.type === "test_record") {
        target.testScores.push(score);
        return;
      }

      target.questionScores.push(score);
    });

    return interactionScoreMap;
  },

  buildLessonEventDerivedMap(lessonEvents = []) {
    const interactionScoreMap = this.buildInteractionScoreMap(lessonEvents);
    const pendingLeaveRequestMap = new Map();

    (lessonEvents || [])
      .filter((item) => item.type === "leave_request" && item.leaveRequestStatus === "pending")
      .forEach((item) => {
        const studentKey = this.getLessonEventTargetStudentKey(item);
        if (!studentKey) return;
        pendingLeaveRequestMap.set(studentKey, {
          applicantStudentName: String(item.leaveApplicantStudentName || "").trim()
        });
      });

    return {
      interactionScoreMap,
      pendingLeaveRequestMap
    };
  },

  buildInteractionDerivedFieldsForRow(row = {}, derivedMap = {}) {
    const studentKey = this.getStudentUniqueId(row);
    const interactionScoreMap = derivedMap.interactionScoreMap instanceof Map
      ? derivedMap.interactionScoreMap
      : new Map();
    const pendingLeaveRequestMap = derivedMap.pendingLeaveRequestMap instanceof Map
      ? derivedMap.pendingLeaveRequestMap
      : new Map();
    const interaction = interactionScoreMap.get(studentKey) || {
      answerScores: [],
      questionScores: [],
      testScores: []
    };
    const pendingLeaveRequest = pendingLeaveRequestMap.get(studentKey) || null;
    const answerScoreAvg = this.getAverageScore(interaction.answerScores);
    const questionScoreAvg = this.getAverageScore(interaction.questionScores);
    const testScoreAvg = this.getAverageScore(interaction.testScores);
    const lessonScoreDetail = this.buildLessonScoreDetail(row.status, {
      answerScoreAvg,
      questionScoreAvg,
      testScoreAvg
    });

    return {
      answerScoreText: interaction.answerScores.join(" / "),
      answerScoreAvg,
      answerScoreAvgText: this.formatScore(answerScoreAvg),
      questionScoreText: interaction.questionScores.join(" / "),
      questionScoreAvg,
      questionScoreAvgText: this.formatScore(questionScoreAvg),
      testScoreText: interaction.testScores.join(" / "),
      testScoreAvg,
      testScoreAvgText: this.formatScore(testScoreAvg),
      hasPendingLeaveRequest: !!pendingLeaveRequest,
      pendingLeaveApplicantName: String(pendingLeaveRequest?.applicantStudentName || "").trim(),
      attendanceScore: lessonScoreDetail.attendanceScore,
      attendanceScoreText: lessonScoreDetail.attendanceScoreText,
      lessonScore: lessonScoreDetail.lessonScore,
      lessonScoreText: lessonScoreDetail.lessonScoreText,
      lessonScoreBreakdownText: lessonScoreDetail.lessonScoreBreakdownText,
      lessonScoreApplicableItems: lessonScoreDetail.lessonScoreApplicableItems
    };
  },

  mergeInteractionIntoList(baseList, lessonEvents = []) {
    const interactionScoreMap = this.buildInteractionScoreMap(lessonEvents);
    const pendingLeaveRequestMap = new Map();

    (lessonEvents || [])
      .filter((item) => item.type === "leave_request" && item.leaveRequestStatus === "pending")
      .forEach((item) => {
        const studentKey = this.getStudentUniqueId(item);
        if (!studentKey) return;
        pendingLeaveRequestMap.set(studentKey, {
          applicantStudentName: String(item.leaveApplicantStudentName || "").trim()
        });
      });

    return (baseList || []).map((item) => {
      const studentKey = this.getStudentUniqueId(item);
      const interaction = interactionScoreMap.get(studentKey) || {
        answerScores: [],
        questionScores: [],
        testScores: []
      };
      const pendingLeaveRequest = pendingLeaveRequestMap.get(studentKey) || null;
      const answerScoreAvg = this.getAverageScore(interaction.answerScores);
      const questionScoreAvg = this.getAverageScore(interaction.questionScores);
      const testScoreAvg = this.getAverageScore(interaction.testScores);
      const lessonScoreDetail = this.buildLessonScoreDetail(item.status, {
        answerScoreAvg,
        questionScoreAvg,
        testScoreAvg
      });

      return {
        ...item,
        answerScoreText: interaction.answerScores.join(" / "),
        answerScoreAvg,
        answerScoreAvgText: this.formatScore(answerScoreAvg),
        questionScoreText: interaction.questionScores.join(" / "),
        questionScoreAvg,
        questionScoreAvgText: this.formatScore(questionScoreAvg),
        testScoreText: interaction.testScores.join(" / "),
        testScoreAvg,
        testScoreAvgText: this.formatScore(testScoreAvg),
        hasPendingLeaveRequest: !!pendingLeaveRequest,
        pendingLeaveApplicantName: String(pendingLeaveRequest?.applicantStudentName || "").trim(),
        attendanceScore: lessonScoreDetail.attendanceScore,
        attendanceScoreText: lessonScoreDetail.attendanceScoreText,
        lessonScore: lessonScoreDetail.lessonScore,
        lessonScoreText: lessonScoreDetail.lessonScoreText,
        lessonScoreBreakdownText: lessonScoreDetail.lessonScoreBreakdownText,
        lessonScoreApplicableItems: lessonScoreDetail.lessonScoreApplicableItems
      };
    });
  },

  rebuildStudentDisplayList(options = {}) {
    const lessonId = String(
      options.lessonId ||
      this.data.selectedLessonId ||
      this.data.lessonId ||
      ""
    ).trim();
    const attendanceDocs = Array.isArray(options.attendanceDocs)
      ? options.attendanceDocs
      : this.latestAttendanceDocs;
    const lessonEvents = Array.isArray(options.lessonEvents)
      ? options.lessonEvents
      : this.data.lessonEvents;
    const baseList = this.cloneBaseRosterList();
    const list = this.buildLessonDisplayList(baseList, attendanceDocs, lessonEvents, { lessonId });
    const nextSignature = this.getAttendanceListSignature(list);
    const currentSignature = this.getAttendanceListSignature(this.data.list);
    const nextPatch = this.buildListViewPatch(list, { lessonId });

    if (nextSignature === currentSignature) {
      if (
        this.data.isCurrentLessonSelected !== nextPatch.isCurrentLessonSelected ||
        JSON.stringify(this.data.signedStudents || []) !== JSON.stringify(nextPatch.signedStudents) ||
        this.data.detailExportDisabled !== nextPatch.detailExportDisabled ||
        this.data.statsExportDisabled !== nextPatch.statsExportDisabled ||
        this.data.signCount !== nextPatch.signCount ||
        this.data.unsignCount !== nextPatch.unsignCount ||
        this.data.absentCount !== nextPatch.absentCount ||
        this.data.waitCount !== nextPatch.waitCount ||
        this.data.leaveCount !== nextPatch.leaveCount ||
        this.getCurrentStatsSignature(this.data.currentStats) !== this.getCurrentStatsSignature(nextPatch.currentStats)
      ) {
        this.setData({
          isCurrentLessonSelected: nextPatch.isCurrentLessonSelected,
          signedStudents: nextPatch.signedStudents,
          detailExportDisabled: nextPatch.detailExportDisabled,
          statsExportDisabled: nextPatch.statsExportDisabled,
          signCount: nextPatch.signCount,
          unsignCount: nextPatch.unsignCount,
          absentCount: nextPatch.absentCount,
          waitCount: nextPatch.waitCount,
          leaveCount: nextPatch.leaveCount,
          currentStats: nextPatch.currentStats
        });
      }
      return list;
    }

    this.setData(nextPatch);
    return list;
  },

  normalizeLessonEvent(item = {}) {
    const payload = item.payload || {};
    const testType = String(payload.testType || "").trim();
    const testSubType = String(payload.testSubType || "").trim();
    const testResult = String(payload.result || "").trim();
    const testStatus = String(payload.status || "").trim();
    const testContent = String(payload.content || "").trim();
    const testAnswer = String(payload.answer || "").trim();
    const testQuestionId = String(payload.questionId || item._id || "").trim();
    const leaveRequestStatus = String(payload.status || "").trim();
    const leaveRequestImageFileId = String(payload.imageFileId || "").trim();
    const leaveApplicantStudentId = String(payload.applicantStudentId || "").trim();
    const leaveApplicantStudentName = String(payload.applicantStudentName || "").trim();
    const leaveRequestedStudentId = String(payload.requestedStudentId || item.studentId || "").trim();
    const leaveRequestedStudentName = String(payload.requestedStudentName || item.studentName || "").trim();
    const testOptions = Array.isArray(payload.options)
      ? payload.options.map((option) => String(option || "").trim()).filter(Boolean)
      : [];
    const testCorrectAnswer = String(payload.correctAnswer || "").trim();

    return {
      ...item,
      _id: String(item._id || "").trim(),
      studentId: String(item.studentId || "").trim(),
      studentName: String(item.studentName || "").trim(),
      type: String(item.type || "").trim(),
      score: item.score ?? "",
      round: Number(item.round || 0),
      testType,
      testSubType,
      testResult,
      testStatus,
      testContent,
      testAnswer,
      testQuestionId,
      leaveRequestStatus,
      leaveRequestStatusLabel: this.getLeaveRequestStatusLabel(leaveRequestStatus),
      leaveRequestImageFileId,
      leaveApplicantStudentId,
      leaveApplicantStudentName,
      leaveRequestedStudentId,
      leaveRequestedStudentName,
      testOptions,
      testOptionsText: testOptions.join(" / "),
      testCorrectAnswer,
      testSummary: item.type === "test_record" || item.type === "test_publish"
        ? [testType, testSubType, testResult, testStatus].filter(Boolean).join(" / ")
        : "",
      displayType: this.getLessonEventTypeLabel(item.type),
      displayTime: this.formatSimpleDateTime(item.createdAt)
    };
  },

  getEventTimestamp(item = {}) {
    const createdAt = item?.createdAt;
    if (!createdAt) return 0;

    if (createdAt instanceof Date) {
      return createdAt.getTime();
    }

    if (typeof createdAt?.toDate === "function") {
      const date = createdAt.toDate();
      return date instanceof Date ? date.getTime() : 0;
    }

    const timestamp = new Date(createdAt).getTime();
    return Number.isNaN(timestamp) ? 0 : timestamp;
  },

  getRollcallScoreKey(item = {}) {
    const round = Number(item.round || 0);
    const studentKey = this.getStudentUniqueId(item);
    if (!round || !studentKey) return "";
    return `${round}::${studentKey}`;
  },

  rememberRecentAnswerScore(item = {}) {
    const scoreKey = this.getRollcallScoreKey(item);
    if (!scoreKey) return;

    if (!(this.recentAnswerScoreKeys instanceof Set)) {
      this.recentAnswerScoreKeys = new Set();
    }

    this.recentAnswerScoreKeys.add(scoreKey);
  },

  clearRecentAnswerScoreKeys() {
    this.recentAnswerScoreKeys = new Set();
  },

  getRollcallStateSignature(state = {}) {
    return JSON.stringify({
      currentRound: Number(state.currentRound || 0),
      currentRoundCalledIds: (state.currentRoundCalledIds || []).map((item) => String(item || "")),
      pendingScoreLock: !!state.pendingScoreLock,
      currentCalledStudent: state.currentCalledStudent
        ? {
          studentId: String(state.currentCalledStudent.studentId || ""),
          name: String(state.currentCalledStudent.name || ""),
          round: Number(state.currentCalledStudent.round || 0)
        }
        : null
    });
  },

  rebuildRollcallState(lessonEvents = []) {
    const signedStudents = Array.isArray(this.data.signedStudents) ? this.data.signedStudents : [];
    const signedIdSet = new Set(
      signedStudents
        .map((item) => this.getStudentUniqueId(item))
        .filter(Boolean)
    );
    const rollcallEvents = lessonEvents
      .filter((item) => item.type === "rollcall")
      .sort((a, b) => this.getEventTimestamp(a) - this.getEventTimestamp(b));
    const scoreEventKeys = lessonEvents
      .filter((item) => item.type === "answer_score")
      .map((item) => this.getRollcallScoreKey(item))
      .filter(Boolean);
    const recentAnswerScoreKeys = this.recentAnswerScoreKeys instanceof Set
      ? Array.from(this.recentAnswerScoreKeys)
      : [];
    const scoredRollcallKeySet = new Set(
      [
        ...scoreEventKeys,
        ...recentAnswerScoreKeys
      ]
    );

    if (recentAnswerScoreKeys.length > 0 && scoreEventKeys.length > 0) {
      scoreEventKeys.forEach((key) => {
        if (this.recentAnswerScoreKeys instanceof Set) {
          this.recentAnswerScoreKeys.delete(key);
        }
      });
    }

    const roundCalledMap = new Map();
    let maxRound = 0;

    rollcallEvents.forEach((item) => {
      const round = Number(item.round || 1);
      const studentKey = this.getStudentUniqueId(item);
      if (!studentKey) return;
      maxRound = Math.max(maxRound, round);
      if (!roundCalledMap.has(round)) {
        roundCalledMap.set(round, new Set());
      }
      roundCalledMap.get(round).add(studentKey);
    });

    const activeRound = maxRound || 1;
    const activeCalledSet = roundCalledMap.get(activeRound) || new Set();
    const currentRoundCalledIds = Array.from(activeCalledSet).filter((id) => !signedIdSet.size || signedIdSet.has(id));
    const pendingRollcallEvents = rollcallEvents.filter((item) => !scoredRollcallKeySet.has(this.getRollcallScoreKey(item)));
    const latestPendingRollcall = pendingRollcallEvents[pendingRollcallEvents.length - 1] || null;
    const hasPendingRollcall = !!latestPendingRollcall;
    const pendingRollcallRound = latestPendingRollcall
      ? Number(latestPendingRollcall.round || activeRound || 1)
      : 0;
    const currentCalledStudent = hasPendingRollcall
      ? {
        studentId: String(latestPendingRollcall.studentId || "").trim(),
        name: String(latestPendingRollcall.studentName || "").trim(),
        round: pendingRollcallRound
      }
      : null;
    const pendingScoreLock = hasPendingRollcall;

    const nextState = hasPendingRollcall
      ? {
        currentRound: pendingRollcallRound || activeRound,
        currentRoundCalledIds,
        pendingScoreLock,
        currentCalledStudent
      }
      : (signedIdSet.size > 0 && currentRoundCalledIds.length >= signedIdSet.size
        ? {
          currentRound: activeRound + 1,
          currentRoundCalledIds: [],
          pendingScoreLock,
          currentCalledStudent
        }
        : {
          currentRound: activeRound,
          currentRoundCalledIds,
          pendingScoreLock,
          currentCalledStudent
        });

    const currentState = {
      currentRound: this.data.currentRound,
      currentRoundCalledIds: this.data.currentRoundCalledIds,
      pendingScoreLock: this.data.pendingScoreLock,
      currentCalledStudent: this.data.currentCalledStudent
    };

    if (this.getRollcallStateSignature(nextState) !== this.getRollcallStateSignature(currentState)) {
      this.setData(nextState);
    }
  },

  rebuildQuestionRequestState(lessonEvents = []) {
    const requestEvents = lessonEvents.filter((item) => item.type === "question_request");
    const approvedEvents = lessonEvents
      .filter((item) => item.type === "question_approved")
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    const scoreEvents = lessonEvents.filter((item) => item.type === "question_score");
    const approvedRequestIds = new Set(
      approvedEvents.map((item) => this.getQuestionRequestId(item)).filter(Boolean)
    );
    const scoredRequestIds = new Set(
      scoreEvents.map((item) => this.getQuestionRequestId(item)).filter(Boolean)
    );

    const pendingQuestionRequests = requestEvents.filter((item) => {
      const requestId = this.getQuestionRequestId(item);
      return requestId && !approvedRequestIds.has(requestId) && !scoredRequestIds.has(requestId);
    });

    const currentQuestionRequest = approvedEvents.find((item) => {
      const requestId = this.getQuestionRequestId(item);
      return requestId && !scoredRequestIds.has(requestId);
    }) || null;

    const nextSignature = this.getQuestionStateSignature(pendingQuestionRequests, currentQuestionRequest);
    const currentSignature = this.getQuestionStateSignature(
      this.data.pendingQuestionRequests,
      this.data.currentQuestionRequest
    );

    if (nextSignature !== currentSignature) {
      this.setData({
        pendingQuestionRequests,
        currentQuestionRequest
      });
    }
  },

  rebuildLeaveRequestState(lessonEvents = []) {
    const pendingLeaveRequests = lessonEvents.filter((item) => {
      if (item.type !== "leave_request") return false;
      return String(item.leaveRequestStatus || "pending").trim() === "pending";
    });

    const nextSignature = this.getLeaveRequestStateSignature(pendingLeaveRequests);
    const currentSignature = this.getLeaveRequestStateSignature(this.data.pendingLeaveRequests);

    if (nextSignature !== currentSignature) {
      this.setData({
        pendingLeaveRequests
      });
    }
  },

  rebuildCurrentTestState(lessonEvents = []) {
    const publishedTests = lessonEvents
      .filter((item) => item.type === "test_publish" && item.testType === "single_choice")
      .sort((a, b) => this.getEventTimestamp(b) - this.getEventTimestamp(a));
    const currentPublishedTest = publishedTests[0] || null;
    const currentQuestionId = String(currentPublishedTest?._id || "").trim();
    const currentTestRecords = currentQuestionId
      ? lessonEvents.filter(
        (item) => item.type === "test_record" && item.testQuestionId === currentQuestionId
      )
      : [];

    const nextSignature = JSON.stringify({
      currentPublishedTest: currentPublishedTest
        ? {
          _id: String(currentPublishedTest._id || ""),
          testQuestionId: String(currentPublishedTest.testQuestionId || ""),
          testContent: String(currentPublishedTest.testContent || "")
        }
        : null,
      currentTestRecords: (currentTestRecords || []).map((item) => ({
        _id: String(item._id || ""),
        studentId: String(item.studentId || ""),
        score: item.score ?? "",
        testAnswer: String(item.testAnswer || "")
      }))
    });
    const currentSignature = JSON.stringify({
      currentPublishedTest: this.data.currentPublishedTest
        ? {
          _id: String(this.data.currentPublishedTest._id || ""),
          testQuestionId: String(this.data.currentPublishedTest.testQuestionId || ""),
          testContent: String(this.data.currentPublishedTest.testContent || "")
        }
        : null,
      currentTestRecords: (this.data.currentTestRecords || []).map((item) => ({
        _id: String(item._id || ""),
        studentId: String(item.studentId || ""),
        score: item.score ?? "",
        testAnswer: String(item.testAnswer || "")
      }))
    });

    if (nextSignature !== currentSignature) {
      this.setData({
        currentPublishedTest,
        currentTestRecords
      });
    }
  },

  async loadQuestionRequestState() {
    const lessonId = String(this.data.selectedLessonId || this.data.lessonId || "").trim();
    if (!lessonId) {
      this.rebuildQuestionRequestState([]);
      return [];
    }

    try {
      const res = await db.collection("lessonEvent")
        .where({
          lessonId,
          type: _.in(["question_request", "question_approved", "question_score"])
        })
        .orderBy("createdAt", "desc")
        .get();
      const lessonEvents = (res.data || []).map((item) => this.normalizeLessonEvent(item));
      this.rebuildQuestionRequestState(lessonEvents);
      return lessonEvents;
    } catch (err) {
      console.error("[signRecord] loadQuestionRequestState failed", err);
      return [];
    }
  },

  async loadLessonEvents(options = {}) {
    this.ensureRuntimeCaches();
    const { silent = false, preferCache = false } = options;
    const lessonId = String(
      options.lessonId ||
      this.data.selectedLessonId ||
      this.data.lessonId ||
      ""
    ).trim();
    if (!lessonId) {
      this.setData({
        lessonEvents: [],
        lessonEventsLoading: false
      });
      return [];
    }

    if (this.lessonEventRequestPromise && this.lessonEventRequestKey === lessonId) {
      return this.lessonEventRequestPromise;
    }

    const requestSeq = this.beginLessonEventRequest(lessonId);

    const cachedLessonEvents = preferCache ? this.getFreshLessonEventCache(lessonId) : null;
    if (cachedLessonEvents) {
      this.applyLessonEvents(lessonId, cachedLessonEvents.lessonEvents, { requestSeq });
      return cachedLessonEvents.lessonEvents;
    }

    if (!silent) {
      this.setData({ lessonEventsLoading: true });
    }
    const requestPromise = (async () => {
      try {
      const res = await db.collection("lessonEvent")
        .where({ lessonId })
        .orderBy("createdAt", "desc")
        .get();
      if (
        this.lessonEventRequestPromise !== requestPromise ||
        !this.isLessonActive(lessonId) ||
        !this.canApplyLessonEventsResult(lessonId, requestSeq)
      ) {
        return [];
      }
      const lessonEvents = (res.data || []).map((item) => this.normalizeLessonEvent(item));
      this.lessonEventCacheByLesson.set(lessonId, {
        lessonEvents,
        signature: this.getLessonEventsSignature(lessonEvents),
        fetchedAt: Date.now()
      });
      this.applyLessonEvents(lessonId, lessonEvents, { requestSeq });
      return lessonEvents;
    } catch (err) {
      console.error("[signRecord] loadLessonEvents failed", err);
      if (
        this.lessonEventRequestPromise !== requestPromise ||
        !this.isLessonActive(lessonId) ||
        !this.canApplyLessonEventsResult(lessonId, requestSeq)
      ) {
        return [];
      }
      if (this.data.lessonEvents.length > 0) {
        this.setData({ lessonEvents: [] });
      }
      this.rebuildStudentDisplayList({ lessonEvents: [] });
      this.rebuildRollcallState([]);
      this.rebuildLeaveRequestState([]);
      this.rebuildQuestionRequestState([]);
      this.rebuildCurrentTestState([]);
      return [];
    } finally {
      const isActiveRequest = this.lessonEventRequestPromise === requestPromise;
      if (isActiveRequest) {
        this.lessonEventRequestPromise = null;
        this.lessonEventRequestKey = "";
      }
      if (!silent && isActiveRequest) {
        this.setData({ lessonEventsLoading: false });
      }
    }
    })();

    this.lessonEventRequestKey = lessonId;
    this.lessonEventRequestPromise = requestPromise;
    return requestPromise;
  },

  async refreshInteractionDataAfterLessonChange() {
    this.refreshSignedStudents();
    this.clearRecentAnswerScoreKeys();
    this.latestAttendanceDocs = [];
    this.setData({
      currentCalledStudent: null,
      lessonEvents: [],
      currentRound: 1,
      currentRoundCalledIds: [],
      pendingScoreLock: false,
      pendingLeaveRequests: [],
      pendingQuestionRequests: [],
      currentQuestionRequest: null,
      currentPublishedTest: null,
      currentTestRecords: []
    });
    await this.loadLessonEvents();
  },

  async createLessonEvent(eventData = {}) {
    const lessonId = String(this.data.selectedLessonId || this.data.lessonId || "").trim();
    const classId = String(this.data.classId || "").trim();

    if (!lessonId || !classId) {
      wx.showToast({
        title: "缺少课次信息",
        icon: "none"
      });
      return false;
    }

    try {
      await db.collection("lessonEvent").add({
        data: {
          lessonId,
          classId,
          studentId: String(eventData.studentId || "").trim(),
          studentName: String(eventData.studentName || "").trim(),
          type: String(eventData.type || "").trim(),
          score: Number(eventData.score || 0),
          round: Number(eventData.round || 0),
          payload: eventData.payload || {},
          createdAt: db.serverDate(),
          createdBy: "teacher"
        }
      });
      return true;
    } catch (err) {
      console.error("[signRecord] createLessonEvent failed", err);
      wx.showToast({
        title: "互动记录失败，请稍后重试",
        icon: "none"
      });
      return false;
    }
  },

  async saveAnswerScoreEvent(eventData = {}) {
    const lessonId = String(this.data.selectedLessonId || this.data.lessonId || "").trim();
    const classId = String(this.data.classId || "").trim();
    const targetRound = Number(eventData.round || this.data.currentRound || 0);
    const targetStudentKey = this.getStudentUniqueId(eventData);

    if (!lessonId || !classId || !targetRound || !targetStudentKey) {
      wx.showToast({
        title: "评分信息不完整",
        icon: "none"
      });
      return false;
    }

    try {
      const res = await db.collection("lessonEvent")
        .where({
          classId,
          lessonId,
          type: "answer_score",
          round: targetRound
        })
        .get();

      const existed = (res.data || []).find(
        (item) => this.getStudentUniqueId(item) === targetStudentKey
      );
      const payload = {
        studentId: String(eventData.studentId || "").trim(),
        studentName: String(eventData.studentName || "").trim(),
        score: Number(eventData.score || 0),
        payload: eventData.payload || {},
        createdAt: db.serverDate(),
        createdBy: "teacher"
      };

      if (existed && existed._id) {
        await db.collection("lessonEvent").doc(existed._id).update({
          data: payload
        });
        return true;
      }

      return this.createLessonEvent({
        ...eventData,
        round: targetRound
      });
    } catch (err) {
      console.error("[signRecord] saveAnswerScoreEvent failed", err);
      wx.showToast({
        title: "评分失败，请稍后重试",
        icon: "none"
      });
      return false;
    }
  },

  async saveQuestionScoreEvent(eventData = {}) {
    const lessonId = String(this.data.selectedLessonId || this.data.lessonId || "").trim();
    const classId = String(this.data.classId || "").trim();
    const requestId = String(eventData?.payload?.requestId || "").trim();

    if (!lessonId || !classId || !requestId) {
      wx.showToast({
        title: "提问信息不完整",
        icon: "none"
      });
      return false;
    }

    try {
      const res = await db.collection("lessonEvent")
        .where({
          classId,
          lessonId,
          type: "question_score"
        })
        .get();

      const existed = (res.data || []).find(
        (item) => this.getQuestionRequestId(item) === requestId
      );
      const payload = {
        studentId: String(eventData.studentId || "").trim(),
        studentName: String(eventData.studentName || "").trim(),
        score: Number(eventData.score || 0),
        payload: eventData.payload || {},
        createdAt: db.serverDate(),
        createdBy: "teacher"
      };

      if (existed && existed._id) {
        await db.collection("lessonEvent").doc(existed._id).update({
          data: payload
        });
        return true;
      }

      return this.createLessonEvent(eventData);
    } catch (err) {
      console.error("[signRecord] saveQuestionScoreEvent failed", err);
      wx.showToast({
        title: "提问评分失败，请稍后重试",
        icon: "none"
      });
      return false;
    }
  },

  async saveTestRecordEvent(eventData = {}) {
    const studentId = String(eventData.studentId || "").trim();
    const studentName = String(eventData.studentName || "").trim();
    const payload = eventData.payload || {};

    if (!studentId || !studentName) {
      wx.showToast({
        title: "测试记录学生信息不完整",
        icon: "none"
      });
      return false;
    }

    return this.createLessonEvent({
      studentId,
      studentName,
      type: "test_record",
      score: Number(eventData.score || 0),
      round: Number(eventData.round || this.data.currentRound || 0),
      payload: {
        testType: String(payload.testType || "").trim(),
        testSubType: String(payload.testSubType || "").trim(),
        questionId: String(payload.questionId || "").trim(),
        options: Array.isArray(payload.options) ? payload.options : [],
        correctAnswer: String(payload.correctAnswer || "").trim(),
        result: String(payload.result || "").trim(),
        content: String(payload.content || "").trim(),
        answer: String(payload.answer || "").trim(),
        status: String(payload.status || "").trim()
      }
    });
  },

  async saveTestPublishEvent(eventData = {}) {
    const payload = eventData.payload || {};

    return this.createLessonEvent({
      studentId: "",
      studentName: "",
      type: "test_publish",
      score: 0,
      round: 0,
      payload: {
        testType: String(payload.testType || "").trim(),
        testSubType: String(payload.testSubType || "").trim(),
        options: Array.isArray(payload.options) ? payload.options : [],
        correctAnswer: String(payload.correctAnswer || "").trim(),
        content: String(payload.content || "").trim(),
        status: String(payload.status || "").trim()
      }
    });
  },

  getLessonOrderLabel(lessonId) {
    const targetLessonId = String(lessonId || "").trim();
    if (!targetLessonId) return "";

    const lessons = Array.isArray(this.data.lessons) ? this.data.lessons : [];
    const lessonIndex = lessons.findIndex(
      (item) => String(item?._id || item?.lessonId || "").trim() === targetLessonId
    );

    if (lessonIndex >= 0) {
      return `第${lessonIndex + 1}次课`;
    }

    return "";
  },

  formatSimpleDateTime(value) {
    if (!value) return "";

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return String(value || "");
    }

    const pad = (num) => String(num).padStart(2, "0");
    return [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate())
    ].join("-") + " " + [
      pad(date.getHours()),
      pad(date.getMinutes())
    ].join(":");
  },

  getSignStatusLabel(status) {
    const map = {
      signed: "已签到",
      unsigned: "未签到",
      absent: "旷课",
      leave_wait: "待审批",
      leave_agree: "已请假"
    };
    return map[status] || "未签到";
  },

  async onTapRandomRollcall() {
    const lessonId = String(this.data.selectedLessonId || this.data.lessonId || "").trim();
    if (!lessonId) {
      wx.showToast({
        title: "当前无可用课次",
        icon: "none"
      });
      return;
    }

    if (!Array.isArray(this.data.signedStudents) || this.data.signedStudents.length === 0) {
      wx.showToast({
        title: "当前无已签到学生可点名",
        icon: "none"
      });
      return;
    }

    if (this.data.pendingScoreLock || this.data.currentCalledStudent) {
      wx.showToast({
        title: "请先完成当前点名评分",
        icon: "none"
      });
      return;
    }

    const signedStudents = Array.isArray(this.data.signedStudents) ? this.data.signedStudents : [];
    const calledIdSet = new Set(
      (this.data.currentRoundCalledIds || []).map((item) => String(item || "").trim()).filter(Boolean)
    );
    let round = Number(this.data.currentRound || 1);
    let candidateList = signedStudents.filter((item) => !calledIdSet.has(this.getStudentUniqueId(item)));

    if (candidateList.length === 0) {
      round += 1;
      candidateList = signedStudents.slice();
      this.setData({
        currentRound: round,
        currentRoundCalledIds: []
      });
    }

    const weightedCandidates = this.getWeightedCandidates(candidateList);
    const studentPool = Array.isArray(weightedCandidates) ? weightedCandidates : [];
    if (studentPool.length === 0) {
      wx.showToast({
        title: "当前无可点名学生",
        icon: "none"
      });
      return;
    }

    const index = Math.floor(Math.random() * studentPool.length);
    const student = studentPool[index] || null;
    if (!student) {
      wx.showToast({
        title: "当前无已签到学生可点名",
        icon: "none"
      });
      return;
    }

    const success = await this.createLessonEvent({
      studentId: student.studentId,
      studentName: student.name,
      type: "rollcall",
      score: 0,
      round,
      payload: { source: "signed_random" }
    });

    if (!success) return;

    const studentKey = this.getStudentUniqueId(student);
    const nextCalledIds = Array.from(new Set([...(this.data.currentRoundCalledIds || []), studentKey]));
    this.setData({
      currentCalledStudent: {
        ...student,
        round
      },
      currentRound: round,
      currentRoundCalledIds: nextCalledIds,
      pendingScoreLock: true
    });
    await this.loadLessonEvents();
    wx.showToast({
      title: `已点名${student.name}`,
      icon: "none"
    });
  },

  async onTapScoreAnswer(e) {
    const score = Number(e.currentTarget.dataset.score || 0);
    const student = this.data.currentCalledStudent;

    if (!student || !student.name) {
      wx.showToast({
        title: "请先随机点名",
        icon: "none"
      });
      return;
    }

    if (!score) {
      wx.showToast({
        title: "分值无效",
        icon: "none"
      });
      return;
    }

    const success = await this.saveAnswerScoreEvent({
      studentId: student.studentId,
      studentName: student.name,
      type: "answer_score",
      score,
      round: Number(student.round || this.data.currentRound || 0),
      payload: { basedOn: "rollcall" }
    });

    if (!success) return;

    this.rememberRecentAnswerScore({
      studentId: student.studentId,
      studentName: student.name,
      round: Number(student.round || this.data.currentRound || 0)
    });
    this.setData({
      currentCalledStudent: null,
      pendingScoreLock: false
    });
    await this.loadLessonEvents();
    wx.showToast({
      title: "回答得分已记录",
      icon: "none"
    });
  },

  async onTapSetAttendanceStatus(e) {
    const targetStatus = String(e.currentTarget.dataset.status || "").trim();
    const currentStatus = String(e.currentTarget.dataset.currentStatus || "").trim();
    const studentId = String(e.currentTarget.dataset.studentId || "").trim();
    const studentName = String(e.currentTarget.dataset.studentName || "").trim();
    const status = currentStatus === targetStatus ? "unsigned" : targetStatus;
    const canOperate = this.canEditAttendanceForAction({
      studentId,
      name: studentName,
      status: currentStatus || "unsigned"
    }, status);

    if (!targetStatus || !studentName) {
      wx.showToast({
        title: "学生状态信息无效",
        icon: "none"
      });
      return;
    }

    if (!canOperate) {
      wx.showToast({
        title: "历史课次不可修改考勤",
        icon: "none"
      });
      return;
    }

    const success = await this.saveAttendanceStatus({
      studentId,
      name: studentName
    }, status);

    if (!success) return;

    const targetLeaveRequest = this.getLatestLeaveRequestByStudent({
      studentId,
      studentName
    });

    if (targetLeaveRequest?._id) {
      const nextRequestStatus = status === "leave_agree" ? "approved" : "closed";
      try {
        await db.collection("lessonEvent").doc(targetLeaveRequest._id).update({
          data: {
            payload: {
              ...(targetLeaveRequest.payload || {}),
              status: nextRequestStatus,
              updatedAt: db.serverDate()
            },
            updatedAt: db.serverDate()
          }
        });
        await this.loadLessonEvents({ silent: true });
      } catch (err) {
        console.error("[signRecord] resolve pending leave request failed", err);
      }
    }

    let toastTitle = `${studentName}已设为${this.getAttendanceStatusLabel(status)}`;
    if (targetStatus === "leave_agree") {
      toastTitle = currentStatus === targetStatus
        ? `${studentName}请假已取消，已恢复未生效`
        : `${studentName}已设为请假`;
    } else if (targetStatus === "absent") {
      toastTitle = currentStatus === targetStatus
        ? `${studentName}旷课已取消，已恢复未生效`
        : `${studentName}已设为旷课`;
    }

    wx.showToast({
      title: toastTitle,
      icon: "none"
    });
  },

  async onTapApproveLeaveRequest(e) {
    const requestId = String(e.currentTarget.dataset.requestId || "").trim();
    const studentId = String(e.currentTarget.dataset.studentId || "").trim();
    const studentName = String(e.currentTarget.dataset.studentName || "").trim();
    const canOperate = !!e.currentTarget.dataset.canOperate;

    if (!requestId || !studentName) {
      wx.showToast({
        title: "请假申请无效",
        icon: "none"
      });
      return;
    }

    if (!canOperate) {
      return;
    }

    const success = await this.saveAttendanceStatus({
      studentId,
      name: studentName
    }, "leave_agree");

    if (!success) return;

    const targetRequest = (this.data.pendingLeaveRequests || []).find(
      (item) => String(item._id || "").trim() === requestId
    );

    try {
      await db.collection("lessonEvent").doc(requestId).update({
        data: {
          payload: {
            ...(targetRequest?.payload || {}),
            status: "approved",
            approvedAt: db.serverDate()
          },
          updatedAt: db.serverDate()
        }
      });
      await this.loadLessonEvents({ silent: true });
      wx.showToast({
        title: `${studentName}请假申请已确认`,
        icon: "none"
      });
    } catch (err) {
      console.error("[signRecord] approve leave request failed", err);
      wx.showToast({
        title: "请假确认失败，请稍后重试",
        icon: "none"
      });
    }
  },

  async onTapAddStudentQuestion(e) {
    const score = Number(e.currentTarget.dataset.score || 0);
    const studentId = String(e.currentTarget.dataset.studentId || "").trim();
    const studentName = String(e.currentTarget.dataset.studentName || "").trim();

    if (!studentName) {
      wx.showToast({
        title: "学生信息无效",
        icon: "none"
      });
      return;
    }

    if (!score) {
      wx.showToast({
        title: "分值无效",
        icon: "none"
      });
      return;
    }

    const success = await this.createLessonEvent({
      studentId,
      studentName,
      type: "student_question",
      score,
      payload: { note: "" }
    });

    if (!success) return;

    await this.loadLessonEvents();
    wx.showToast({
      title: "主动提问已记录",
      icon: "none"
    });
  },

  async onTapApproveQuestionRequest(e) {
    const requestId = String(e.currentTarget.dataset.requestId || "").trim();
    const studentId = String(e.currentTarget.dataset.studentId || "").trim();
    const studentName = String(e.currentTarget.dataset.studentName || "").trim();

    if (!requestId || !studentName) {
      wx.showToast({
        title: "提问申请无效",
        icon: "none"
      });
      return;
    }

    if (this.data.currentQuestionRequest && this.getQuestionRequestId(this.data.currentQuestionRequest) === requestId) {
      wx.showToast({
        title: "该提问已允许，待评分",
        icon: "none"
      });
      return;
    }

    if (this.data.currentQuestionRequest && this.getQuestionRequestId(this.data.currentQuestionRequest) !== requestId) {
      wx.showToast({
        title: "请先完成当前提问评分",
        icon: "none"
      });
      return;
    }

    const success = await this.createLessonEvent({
      studentId,
      studentName,
      type: "question_approved",
      score: 0,
      payload: { requestId, basedOn: "question_request" }
    });

    if (!success) return;

    await this.loadLessonEvents();
    wx.showToast({
      title: "已允许学生提问",
      icon: "none"
    });
  },

  async onTapScoreQuestion(e) {
    const score = Number(e.currentTarget.dataset.score || 0);
    const request = this.data.currentQuestionRequest;
    const requestId = this.getQuestionRequestId(request);

    if (!request || !requestId) {
      wx.showToast({
        title: "当前无待评分提问",
        icon: "none"
      });
      return;
    }

    if (!score) {
      wx.showToast({
        title: "分值无效",
        icon: "none"
      });
      return;
    }

    const success = await this.saveQuestionScoreEvent({
      studentId: request.studentId,
      studentName: request.studentName,
      type: "question_score",
      score,
      payload: { requestId, basedOn: "question_approved" }
    });

    if (!success) return;

    this.setData({ currentQuestionRequest: null });
    await this.loadLessonEvents();
    wx.showToast({
      title: "提问得分已记录",
      icon: "none"
    });
  },

  async onTapPublishTestExample() {
    const lessonId = String(this.data.selectedLessonId || this.data.lessonId || "").trim();
    if (!lessonId) {
      wx.showToast({
        title: "当前无可用课次",
        icon: "none"
      });
      return;
    }

    const success = await this.saveTestPublishEvent({
      payload: {
        testType: "single_choice",
        testSubType: "vocabulary",
        options: ["A. apple", "B. banana", "C. orange", "D. pear"],
        correctAnswer: "B",
        content: "示例单选题：banana 对应哪个选项？",
        status: "published"
      }
    });

    if (!success) return;

    await this.loadLessonEvents();
    wx.showToast({
      title: "全班测试样例已发布",
      icon: "none"
    });
  },

  onTapExportLessonStats() {
    if (this.data.lessonsLoading || this.data.statsLoading) {
      wx.showToast({
        title: "数据加载中，请稍后",
        icon: "none"
      });
      return;
    }

    if (!Array.isArray(this.data.stats) || this.data.stats.length === 0) {
      wx.showToast({
        title: "暂无可导出的课次统计",
        icon: "none"
      });
      return;
    }

    this.exportLessonStatsCsv();
  },

  onTapExportLessonDetail() {
    if (this.data.lessonsLoading || this.data.statsLoading) {
      wx.showToast({
        title: "数据加载中，请稍后",
        icon: "none"
      });
      return;
    }

    if (!Array.isArray(this.data.list) || this.data.list.length === 0) {
      wx.showToast({
        title: "当前课次暂无可导出明细",
        icon: "none"
      });
      return;
    }

    this.exportLessonDetailCsv();
  },

  async exportLessonStatsCsv() {
    let stats = Array.isArray(this.data.stats) ? this.data.stats : [];

    if (stats.length === 0) {
      await this.loadStats({ includeHistory: true });
      stats = Array.isArray(this.data.stats) ? this.data.stats : [];
    }

    if (stats.length === 0) {
      wx.showToast({
        title: "暂无可导出的课次统计",
        icon: "none"
      });
      return;
    }

    const classId = String(this.data.classId || "").trim();
    const header = "班级ID,课次,上课时间,应到人数,实到人数,未到人数";
    const rows = stats.map((item) => {
      const lessonLabel = this.getLessonOrderLabel(item?.lessonId) || String(item?.lessonId || "");
      const startTime = this.formatSimpleDateTime(item?.startTime);

      return [
        this.escapeCsv(classId),
        this.escapeCsv(lessonLabel),
        this.escapeCsv(startTime),
        String(item?.rosterCount ?? ""),
        String(item?.signedCount ?? ""),
        String(item?.unsignedCount ?? "")
      ].join(",");
    });
    const csvText = [header, ...rows].join("\n");
    const fileName = classId ? `签到统计_${classId}.csv` : "签到统计_全部课次.csv";

    this.copyCsvToClipboard(csvText, "全部课次统计CSV已复制，可直接粘贴到表格");
  },

  async exportLessonDetailCsv() {
    const classId = String(this.data.classId || "").trim();
    const lessonId = String(this.data.lessonId || this.data.selectedLessonId || "").trim();
    const roster = Array.isArray(this.data.baseRosterList) ? this.data.baseRosterList : [];

    if (!classId || !lessonId) {
      wx.showToast({
        title: "缺少班级或课次信息",
        icon: "none"
      });
      return;
    }

    if (roster.length === 0) {
      wx.showToast({
        title: "当前课次暂无可导出明细",
        icon: "none"
      });
      return;
    }

    let detailList = Array.isArray(this.data.list) ? this.data.list : [];

    if (detailList.length === 0) {
      try {
        const res = await db.collection("attendance")
          .where({ lessonId })
          .get();
        const attendanceList = res.data || [];
        const attendanceByStudentId = new Map();
        const attendanceByName = new Map();

        attendanceList.forEach((item) => {
          const studentId = String(item.studentId || "").trim();
          const studentName = String(item.studentName || "").trim();
          if (studentId) attendanceByStudentId.set(studentId, item);
          if (studentName) attendanceByName.set(studentName, item);
        });

        detailList = roster.map((student) => {
          const studentId = String(student.studentId || student.id || "").trim();
          const name = String(student.name || student.studentName || "").trim();
          const matchedAttendance =
            (studentId && attendanceByStudentId.get(studentId)) ||
            (name && attendanceByName.get(name)) ||
            null;
          const status = String(
            matchedAttendance?.status ||
            matchedAttendance?.attendanceStatus ||
            "unsigned"
          ).trim() || "unsigned";
          return {
            studentId,
            name,
            status
          };
        });
      } catch (err) {
        console.error("[signRecord] exportLessonDetailCsv failed to build detail list", err);
        wx.showToast({
          title: "导出失败，请稍后重试",
          icon: "none"
        });
        return;
      }
    }

    if (detailList.length === 0) {
      wx.showToast({
        title: "当前课次暂无可导出明细",
        icon: "none"
      });
      return;
    }

    const lessonLabel = this.getLessonOrderLabel(lessonId) || lessonId;
    const header = "班级ID,课次,学号,姓名,签到状态";
    const rows = detailList.map((item) => {
      const studentId = String(item?.studentId || item?.id || "").trim();
      const name = String(item?.name || item?.studentName || "").trim();
      const status = String(item?.status || "unsigned").trim() || "unsigned";

      return [
        this.escapeCsv(classId),
        this.escapeCsv(lessonLabel),
        this.escapeCsv(studentId),
        this.escapeCsv(name),
        this.escapeCsv(this.getSignStatusLabel(status))
      ].join(",");
    });

    const csvText = [header, ...rows].join("\n");
    const fileName = `签到明细_${lessonLabel || lessonId}.csv`;
    this.copyCsvToClipboard(csvText, "本次课明细CSV已复制，可直接粘贴到表格");
  },

  /**
   * 加载班级花名册
   * 从 classes 集合获取 roster 数组，构建初始列表
   */
  async loadRoster() {
    const cid = this.data.classId;
    const lessonId = this.data.lessonId;
    if (!cid) return;

    try {
      let students = [];
      let cloudCount = 0;

      try {
        const res = await db.collection("classes").doc(cid).get();
        const cloudStudents = res.data.roster || [];
        cloudCount = cloudStudents.length;
        students = cloudStudents;
      } catch (cloudErr) {
        console.error("[signRecord] load cloud roster failed", cloudErr);
      }

      if (!Array.isArray(students) || students.length === 0) {
        const localStudents = wx.getStorageSync(`students_${cid}`) || [];
        students = localStudents;
      }

      const list = students
        .map((student) => this.normalizeRosterItem(student))
        .filter((item) => item.name);
      const baseRosterList = list.map((item) => ({ ...item }));
      const nextPatch = this.buildListViewPatch(baseRosterList.map((item) => ({ ...item })), {
        currentStats: null
      });
      this.setData({
        baseRosterList,
        ...nextPatch
      });
    } catch (err) {
      console.error("加载花名册失败：", err);
      this.setData({
        pageErrorText: "名单读取失败，请下拉刷新或重新加载。"
      });
      wx.showToast({ title: "加载名单失败", icon: "none" });
    }
  },

  async loadLessons() {
    const classId = String(this.data.classId || "").trim();
    if (!classId) {
      this.setData({
        lessons: [],
        lessonsLoading: false
      });
      this.refreshExportDisabledState();
      return [];
    }

    this.setData({ lessonsLoading: true });
    this.refreshExportDisabledState();

    try {
      const res = await wx.cloud.callFunction({
        name: "getLessonsByClass",
        data: { classId }
      });
      const lessons = res.result?.success ? (res.result.lessons || []) : [];
      this.setData({ lessons });
      this.refreshExportDisabledState();
      return lessons;
    } catch (err) {
      console.error("[signRecord] load lessons failed", {
        classId,
        err
      });
      this.setData({
        pageErrorText: "课次读取失败，请下拉刷新或重新加载。"
      });
      this.setData({ lessons: [] });
      this.refreshExportDisabledState();
      return [];
    } finally {
      this.setData({ lessonsLoading: false });
      this.refreshExportDisabledState();
    }
  },

  resolveInitialLessonId(lessons = []) {
    if (lessons.length > 0) {
      return String(lessons[0]?._id || "").trim();
    }

    const currentLessonId = String(this.data.lessonId || "").trim();
    const selectedLessonId = String(this.data.selectedLessonId || "").trim();
    return String(selectedLessonId || currentLessonId || "").trim();
  },

  async switchLesson(lessonId) {
    this.ensureRuntimeCaches();
    const nextLessonId = String(lessonId || "").trim();
    this.isHydratingLesson = true;
    try {
      if (!nextLessonId) {
        this.clearAttendancePolling();
        this.clearLessonEventPolling();
        this.registerPostSwitchSnapshot({ lessonId: "" });
        const list = this.cloneBaseRosterList();
        const nextPatch = this.buildListViewPatch(list, {
          currentStats: null,
          lessonId: ""
        });
        this.setData({
          lessonId: "",
          selectedLessonId: "",
          ...nextPatch,
          lessonEvents: [],
          pendingLeaveRequests: []
        });
        return;
      }

      this.clearAttendancePolling();
      this.clearLessonEventPolling();

      const baseList = this.cloneBaseRosterList();
      const cachedAttendance = this.getFreshAttendanceCache(nextLessonId);
      const cachedLessonEvents = this.getFreshLessonEventCache(nextLessonId);
      const nextCurrentStats =
        (this.data.stats || []).find(item => item.lessonId === nextLessonId) ||
        this.data.currentStats ||
        null;
      const nextList = this.buildLessonDisplayList(
        baseList,
        cachedAttendance?.docs || [],
        cachedLessonEvents?.lessonEvents || [],
        { lessonId: nextLessonId }
      );
      const nextPatch = this.buildListViewPatch(nextList, {
        currentStats: nextCurrentStats,
        lessonId: nextLessonId
      });
      this.setData({
        lessonId: nextLessonId,
        selectedLessonId: nextLessonId,
        lessonEvents: cachedLessonEvents?.lessonEvents || [],
        ...nextPatch
      });
      this.registerPostSwitchSnapshot({
        lessonId: nextLessonId,
        attendanceSignature: cachedAttendance
          ? this.getAttendanceDocsSignature(cachedAttendance.docs)
          : null,
        lessonEventsSignature: cachedLessonEvents
          ? this.getLessonEventsSignature(cachedLessonEvents.lessonEvents)
          : null,
        statsSignature: nextPatch.currentStats
          ? this.getCurrentStatsSignature(nextPatch.currentStats)
          : null
      });
      this.latestAttendanceDocs = Array.isArray(cachedAttendance?.docs) ? cachedAttendance.docs : [];
      this.latestAttendanceSignature = this.getAttendanceDocsSignature(this.latestAttendanceDocs);
      if (cachedLessonEvents) {
        this.rebuildRollcallState(cachedLessonEvents.lessonEvents);
        this.rebuildLeaveRequestState(cachedLessonEvents.lessonEvents);
        this.rebuildQuestionRequestState(cachedLessonEvents.lessonEvents);
        this.rebuildCurrentTestState(cachedLessonEvents.lessonEvents);
      }

      await Promise.all([
        this.fetchAttendanceOnce(nextLessonId, {
          preferCache: true
        }),
        this.loadLessonEvents({
          silent: true,
          lessonId: nextLessonId,
          preferCache: true
        })
      ]);

      if (!this.isLessonActive(nextLessonId)) {
        return;
      }

      this.startAttendancePolling(nextLessonId);
      this.startLessonEventPolling(nextLessonId);
      void this.loadStats({
        lessonId: nextLessonId,
        includeHistory: false
      });
    } finally {
      this.isHydratingLesson = false;
    }
  },

  onSelectLesson(e) {
    const lessonId = String(e.currentTarget.dataset.lessonId || "").trim();
    if (!lessonId || lessonId === this.data.selectedLessonId) return;
    this.switchLesson(lessonId);
  },

  async fetchAttendanceOnce(targetLessonId = "", options = {}) {
    this.ensureRuntimeCaches();
    const lessonId = String(targetLessonId || "").trim();
    const classId = String(this.data.classId || "").trim();
    const preferCache = options.preferCache === true;

    if (!lessonId) {
      return;
    }

    if (!classId) {
      return;
    }

    const cachedAttendance = preferCache ? this.getFreshAttendanceCache(lessonId) : null;
    if (cachedAttendance) {
      this.syncAttendance(cachedAttendance.docs, { lessonId });
      return cachedAttendance.docs;
    }

    if (this.attendanceRequestPromise && this.attendanceRequestKey === lessonId) {
      return this.attendanceRequestPromise;
    }

    const requestPromise = (async () => {
      try {
      const res = await db.collection("attendance")
        .where({ lessonId })
        .get();
      if (this.attendanceRequestPromise !== requestPromise || !this.isLessonActive(lessonId)) {
        return [];
      }
      const docs = res.data || [];
      this.attendanceCacheByLesson.set(lessonId, {
        docs,
        signature: this.getAttendanceDocsSignature(docs),
        fetchedAt: Date.now()
      });
      this.syncAttendance(docs, { lessonId });
      return docs;
    } catch (err) {
      console.error("[signRecord] fetch attendance failed", {
        classId,
        lessonId,
        err
      });
      return [];
    } finally {
      if (this.attendanceRequestPromise === requestPromise) {
        this.attendanceRequestPromise = null;
        this.attendanceRequestKey = "";
      }
    }
    })();

    this.attendanceRequestKey = lessonId;
    this.attendanceRequestPromise = requestPromise;
    return requestPromise;
  },

  isLessonActive(lessonId = "") {
    const activeLessonId = String(this.data.selectedLessonId || this.data.lessonId || "").trim();
    return !!lessonId && lessonId === activeLessonId;
  },

  beginLessonEventRequest(lessonId = "") {
    this.ensureRuntimeCaches();
    const targetLessonId = String(lessonId || "").trim();
    if (!targetLessonId) return 0;
    this.lessonEventRequestSeq += 1;
    this.latestLessonEventSeqByLesson.set(targetLessonId, this.lessonEventRequestSeq);
    return this.lessonEventRequestSeq;
  },

  canApplyLessonEventsResult(lessonId = "", requestSeq = 0) {
    this.ensureRuntimeCaches();
    const targetLessonId = String(lessonId || "").trim();
    if (!targetLessonId || !this.isLessonActive(targetLessonId)) return false;
    if (!requestSeq) return true;
    return this.latestLessonEventSeqByLesson.get(targetLessonId) === requestSeq;
  },

  startAttendancePolling(targetLessonId = "") {
    const lessonId = String(targetLessonId || "").trim();
    const classId = String(this.data.classId || "").trim();

    if (!lessonId) {
      return;
    }

    if (!classId) {
      return;
    }

    this.clearAttendancePolling();

    this.attendancePollingLessonId = lessonId;
    this.attendancePollingTimer = setInterval(() => {
      this.fetchAttendanceOnce(lessonId);
    }, 3000);
  },

  startLessonEventPolling(targetLessonId = "") {
    const lessonId = String(targetLessonId || "").trim();

    if (!lessonId) {
      return;
    }

    this.clearLessonEventPolling();

    this.lessonEventPollingLessonId = lessonId;
    this.lessonEventPollingTimer = setInterval(() => {
      this.loadLessonEvents({ silent: true });
    }, 5000);
  },

  clearAttendancePolling() {
    if (this.attendancePollingTimer) {
      clearInterval(this.attendancePollingTimer);
    }
    this.attendancePollingTimer = null;
    this.attendancePollingLessonId = "";
  },

  clearLessonEventPolling() {
    if (this.lessonEventPollingTimer) {
      clearInterval(this.lessonEventPollingTimer);
    }
    this.lessonEventPollingTimer = null;
    this.lessonEventPollingLessonId = "";
  },

  async refreshAttendance() {
    await this.fetchAttendanceOnce(this.data.selectedLessonId || this.data.lessonId);
  },

  // 将签到数据同步到当前列表
  applyLessonEvents(lessonId = "", lessonEvents = [], options = {}) {
    this.ensureRuntimeCaches();
    if (!this.canApplyLessonEventsResult(lessonId, options.requestSeq || 0)) return;
    const nextSignature = this.getLessonEventsSignature(lessonEvents);
    if (this.shouldSkipPostSwitchLessonEventPatch(lessonId, nextSignature)) {
      return;
    }
    const currentSignature = this.getLessonEventsSignature(this.data.lessonEvents);
    const nextState = {};
    if (nextSignature !== currentSignature) {
      nextState.lessonEvents = lessonEvents;
    }

    const rowPatchResult = this.buildLessonEventRowPatches(lessonEvents);
    if (rowPatchResult.shouldFallback) {
      if (Object.keys(nextState).length > 0) {
        this.setData(nextState);
      }
      this.rebuildStudentDisplayList({
        lessonEvents,
        lessonId
      });
    } else if (Object.keys(rowPatchResult.patches || {}).length > 0 || Object.keys(nextState).length > 0) {
      this.setData({
        ...nextState,
        ...rowPatchResult.patches
      });
    }

    this.rebuildRollcallState(lessonEvents);
    this.rebuildLeaveRequestState(lessonEvents);
    this.rebuildQuestionRequestState(lessonEvents);
    this.rebuildCurrentTestState(lessonEvents);
  },

  syncAttendance(docs, options = {}) {
    this.ensureRuntimeCaches();
    const lessonId = String(options.lessonId || this.data.selectedLessonId || this.data.lessonId || "").trim();
    if (lessonId && !this.isLessonActive(lessonId)) return;
    const prevDocs = Array.isArray(this.latestAttendanceDocs) ? this.latestAttendanceDocs : [];
    const nextDocs = Array.isArray(docs) ? docs : [];
    const nextSignature = this.getAttendanceDocsSignature(nextDocs);
    if (this.latestAttendanceSignature === nextSignature) {
      return;
    }
    if (this.shouldSkipPostSwitchAttendancePatch(lessonId, nextSignature)) {
      this.latestAttendanceDocs = nextDocs;
      this.latestAttendanceSignature = nextSignature;
      return;
    }

    const currentList = Array.isArray(this.data.list) ? this.data.list : [];
    const prevAttendanceDocMap = this.buildAttendanceDocMap(prevDocs, currentList);
    const nextAttendanceDocMap = this.buildAttendanceDocMap(nextDocs, currentList);
    const changedStudentKeys = this.collectChangedAttendanceStudentIds(
      prevAttendanceDocMap,
      nextAttendanceDocMap
    );

    this.latestAttendanceDocs = nextDocs;
    this.latestAttendanceSignature = nextSignature;
    if (changedStudentKeys.length === 0) {
      return;
    }

    const rowPatchResult = this.buildAttendanceRowPatches(changedStudentKeys, {
      lessonId,
      attendanceDocs: nextDocs,
      nextAttendanceDocMap
    });

    if (rowPatchResult.shouldFallback) {
      this.rebuildStudentDisplayList({
        attendanceDocs: this.latestAttendanceDocs,
        lessonId
      });
      return;
    }

    const nextMetaPatch = this.buildListMetaPatch(rowPatchResult.nextList, {
      lessonId,
      currentStats: this.data.currentStats
    });
    const summaryPatch = {};

    if (this.data.isCurrentLessonSelected !== nextMetaPatch.isCurrentLessonSelected) {
      summaryPatch.isCurrentLessonSelected = nextMetaPatch.isCurrentLessonSelected;
    }
    if (JSON.stringify(this.data.signedStudents || []) !== JSON.stringify(nextMetaPatch.signedStudents || [])) {
      summaryPatch.signedStudents = nextMetaPatch.signedStudents;
    }
    if (this.data.detailExportDisabled !== nextMetaPatch.detailExportDisabled) {
      summaryPatch.detailExportDisabled = nextMetaPatch.detailExportDisabled;
    }
    if (this.data.statsExportDisabled !== nextMetaPatch.statsExportDisabled) {
      summaryPatch.statsExportDisabled = nextMetaPatch.statsExportDisabled;
    }
    if (this.data.signCount !== nextMetaPatch.signCount) {
      summaryPatch.signCount = nextMetaPatch.signCount;
    }
    if (this.data.unsignCount !== nextMetaPatch.unsignCount) {
      summaryPatch.unsignCount = nextMetaPatch.unsignCount;
    }
    if (this.data.absentCount !== nextMetaPatch.absentCount) {
      summaryPatch.absentCount = nextMetaPatch.absentCount;
    }
    if (this.data.waitCount !== nextMetaPatch.waitCount) {
      summaryPatch.waitCount = nextMetaPatch.waitCount;
    }
    if (this.data.leaveCount !== nextMetaPatch.leaveCount) {
      summaryPatch.leaveCount = nextMetaPatch.leaveCount;
    }
    if (
      this.getCurrentStatsSignature(this.data.currentStats) !==
      this.getCurrentStatsSignature(nextMetaPatch.currentStats)
    ) {
      summaryPatch.currentStats = nextMetaPatch.currentStats;
    }

    const nextState = {
      ...rowPatchResult.patches,
      ...summaryPatch
    };

    if (Object.keys(nextState).length > 0) {
      this.setData(nextState);
    }
  },

  /**
   * 重新计算统计数字
   */
  refreshStats() {
    const list = Array.isArray(this.data.list) ? this.data.list : [];
    const nextState = this.buildDerivedStatsFromList(list);
    if (
      this.data.signCount !== nextState.signCount ||
      this.data.unsignCount !== nextState.unsignCount ||
      this.data.absentCount !== nextState.absentCount ||
      this.data.waitCount !== nextState.waitCount ||
      this.data.leaveCount !== nextState.leaveCount ||
      this.getCurrentStatsSignature(this.data.currentStats) !== this.getCurrentStatsSignature(nextState.currentStats)
    ) {
      this.setData(nextState);
    }
  },

  showStatus(s) {
    const map = {
      signed: "已签到",
      unsigned: "未签到",
      absent: "旷课",
      leave_wait: "待审批",
      leave_agree: "已请假"
    };
    return map[s] || s;
  },

  /**
   * 锚点跳转：点击上方统计卡片快速定位学生
   */
  jumpTo(e) {
    const type = e.currentTarget.dataset.type;
    const list = this.data.list;
    const targets = list.map((item, idx) => item.status === type ? idx : -1).filter(i => i >= 0);
    
    if (targets.length === 0) return;
    
    let cur = this.data.jumpCursor[type] || 0;
    if (cur >= targets.length) cur = 0;
    
    wx.pageScrollTo({ selector: "#item-" + targets[cur], duration: 300 });
    this.setData({ [`jumpCursor.${type}`]: cur + 1 });
  },

  previewImg(e) {
    const url = e.currentTarget.dataset.src;
    if (url) wx.previewImage({ urls: [url] });
  }
});
