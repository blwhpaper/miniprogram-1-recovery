const db = wx.cloud.database()
const _ = db.command

Page({
  data: {
    classId: "",
    lessonId: "",
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
    interactionScoreOptions: [1, 2, 3, 5],
    currentRound: 1,
    currentRoundCalledIds: [],
    pendingScoreLock: false,
    signCount: 0,
    unsignCount: 0,
    absentCount: 0,
    waitCount: 0,
    leaveCount: 0,
    jumpCursor: {}
  },

  attendancePollingTimer: null,
  attendancePollingLessonId: "",

  normalizeRosterItem(student) {
    if (typeof student === "string") {
      return {
        studentId: "",
        name: student,
        status: "unsigned",
        img: ""
      };
    }

    return {
      studentId: String(student?.studentId || student?.id || "").trim(),
      name: String(student?.name || "").trim(),
      status: "unsigned",
      img: ""
    };
  },

  cloneBaseRosterList() {
    return (this.data.baseRosterList || []).map((item) => ({ ...item }));
  },

  mergeAttendanceIntoList(baseList, docs = []) {
    const attendanceByStudentId = new Map();
    const attendanceByName = new Map();

    console.log("[signRecord] baseList", baseList);
    console.log("[signRecord] attendance docs", docs);

    docs.forEach((doc) => {
      const studentId = String(doc.studentId || "").trim();
      const studentName = String(doc.studentName || "").trim();

      if (studentId) attendanceByStudentId.set(studentId, doc);
      if (studentName) attendanceByName.set(studentName, doc);
    });

    return baseList.map((item) => {
      const matchedById = item.studentId && attendanceByStudentId.get(item.studentId);
      const matchedByName = item.name && attendanceByName.get(item.name);
      console.log("[signRecord] compare", {
        rosterStudentId: item.studentId,
        rosterName: item.name,
        matchedById,
        matchedByName
      });

      const matchedDoc =
        matchedById ||
        matchedByName;

      if (!matchedDoc) return { ...item };

      return {
        ...item,
        status: "signed"
      };
    });
  },

  onLoad(options) {
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

  onShow() {
    const lessonId = String(this.data.selectedLessonId || this.data.lessonId || "").trim();
    if (!lessonId) return;

    this.fetchAttendanceOnce(lessonId);
    this.startAttendancePolling(lessonId);
  },

  onUnload() {
    this.clearAttendancePolling();
  },

  onHide() {
    this.clearAttendancePolling();
  },

  async onPullDownRefresh() {
    try {
      await this.refreshAttendance();
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  async initData() {
    wx.showLoading({ title: "加载中..." });
    try {
      await this.loadRoster();
      const lessons = await this.loadLessons();
      const initialLessonId = this.resolveInitialLessonId(lessons);

      if (initialLessonId) {
        await this.switchLesson(initialLessonId);
      } else {
        const list = this.cloneBaseRosterList();
        this.setData({
          lessonId: "",
          selectedLessonId: "",
          list,
          currentCalledStudent: null,
          lessonEvents: []
        });
        this.refreshSignedStudents();
        this.refreshExportDisabledState();
        this.refreshStats();
      }
      await this.loadStats();
    } finally {
      wx.hideLoading();
    }
  },

  async loadStats() {
    const classId = String(this.data.classId || "").trim();
    const lessonId = String(this.data.lessonId || this.data.selectedLessonId || "").trim();
    if (!classId) return;

    this.setData({ statsLoading: true });
    this.refreshExportDisabledState();
    try {
      const res = await wx.cloud.callFunction({
        name: "getLessonStatsByClass",
        data: { classId }
      });

      if (res.result && res.result.success) {
        const stats = Array.isArray(res.result.stats) ? res.result.stats : [];
        const currentStats =
          stats.find(item => String(item.lessonId || "").trim() === lessonId) || null;

        this.setData({
          stats,
          currentStats
        });
        this.refreshExportDisabledState();
      } else {
        this.setData({
          stats: [],
          currentStats: null
        });
        this.refreshExportDisabledState();
      }
    } catch (err) {
      console.error("[signRecord] loadStats failed", err);
      this.setData({
        stats: [],
        currentStats: null
      });
      this.refreshExportDisabledState();
    } finally {
      this.setData({ statsLoading: false });
      this.refreshExportDisabledState();
    }
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

  refreshExportDisabledState() {
    const { lessonsLoading, statsLoading, list, stats } = this.data;
    const isListInvalid = !Array.isArray(list) || list.length === 0;
    const isStatsInvalid = !Array.isArray(stats) || stats.length === 0;

    this.setData({
      detailExportDisabled: Boolean(lessonsLoading || statsLoading || isListInvalid),
      statsExportDisabled: Boolean(lessonsLoading || statsLoading || isStatsInvalid)
    });
  },

  refreshSignedStudents() {
    const list = Array.isArray(this.data.list) ? this.data.list : [];
    const signedStudents = list
      .filter((item) => item.status === "signed")
      .map((item) => ({
        studentId: String(item.studentId || item.id || "").trim(),
        name: String(item.name || item.studentName || "").trim()
      }))
      .filter((item) => item.name);

    this.setData({ signedStudents });
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

  getWeightedCandidates(candidateList = []) {
    return candidateList;
  },

  getLessonEventTypeLabel(type) {
    const map = {
      rollcall: "随机点名",
      answer_score: "回答得分",
      student_question: "主动提问"
    };
    return map[type] || type;
  },

  normalizeLessonEvent(item = {}) {
    return {
      ...item,
      studentId: String(item.studentId || "").trim(),
      studentName: String(item.studentName || "").trim(),
      type: String(item.type || "").trim(),
      score: item.score ?? "",
      round: Number(item.round || 0),
      displayType: this.getLessonEventTypeLabel(item.type),
      displayTime: this.formatSimpleDateTime(item.createdAt)
    };
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
      .sort((a, b) => {
        const timeA = new Date(a.createdAt || 0).getTime();
        const timeB = new Date(b.createdAt || 0).getTime();
        return timeA - timeB;
      });

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
    const latestRollcall = rollcallEvents[rollcallEvents.length - 1] || null;
    const latestRollcallStudentKey = latestRollcall
      ? this.getStudentUniqueId(latestRollcall)
      : "";
    const matchedAnswerScore = latestRollcall
      ? lessonEvents.find((item) => (
        item.type === "answer_score" &&
        Number(item.round || 0) === Number(latestRollcall.round || 0) &&
        this.getStudentUniqueId(item) === latestRollcallStudentKey
      ))
      : null;
    const hasPendingRollcall = !!(
      latestRollcall &&
      !matchedAnswerScore
    );
    const currentCalledStudent = hasPendingRollcall
      ? {
        studentId: String(latestRollcall.studentId || "").trim(),
        name: String(latestRollcall.studentName || "").trim()
      }
      : null;
    const pendingScoreLock = hasPendingRollcall;

    if (signedIdSet.size > 0 && currentRoundCalledIds.length >= signedIdSet.size) {
      this.setData({
        currentRound: activeRound + 1,
        currentRoundCalledIds: [],
        pendingScoreLock,
        currentCalledStudent
      });
      return;
    }

    this.setData({
      currentRound: activeRound,
      currentRoundCalledIds,
      pendingScoreLock,
      currentCalledStudent
    });
  },

  async loadLessonEvents() {
    const lessonId = String(this.data.selectedLessonId || this.data.lessonId || "").trim();
    if (!lessonId) {
      this.setData({
        lessonEvents: [],
        lessonEventsLoading: false
      });
      return [];
    }

    this.setData({ lessonEventsLoading: true });
    try {
      const res = await db.collection("lessonEvent")
        .where({ lessonId })
        .orderBy("createdAt", "desc")
        .get();
      const lessonEvents = (res.data || []).map((item) => this.normalizeLessonEvent(item));
      this.setData({ lessonEvents });
      this.rebuildRollcallState(lessonEvents);
      return lessonEvents;
    } catch (err) {
      console.error("[signRecord] loadLessonEvents failed", err);
      this.setData({ lessonEvents: [] });
      this.rebuildRollcallState([]);
      return [];
    } finally {
      this.setData({ lessonEventsLoading: false });
    }
  },

  async refreshInteractionDataAfterLessonChange() {
    this.refreshSignedStudents();
    this.setData({
      currentCalledStudent: null,
      lessonEvents: [],
      currentRound: 1,
      currentRoundCalledIds: [],
      pendingScoreLock: false
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
    return status === "signed" ? "已签到" : "未签到";
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
      currentCalledStudent: student,
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
      round: Number(this.data.currentRound || 0),
      payload: { basedOn: "rollcall" }
    });

    if (!success) return;

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
      await this.loadStats();
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

    console.log("[signRecord] export lesson stats fileName =", fileName);
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
        const signedSet = new Set(
          attendanceList
            .map(item => String(item.studentId || "").trim())
            .filter(Boolean)
        );

        detailList = roster.map((student) => {
          const studentId = String(student.studentId || student.id || "").trim();
          const name = String(student.name || student.studentName || "").trim();
          return {
            studentId,
            name,
            status: signedSet.has(studentId) ? "signed" : "unsigned"
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
    console.log("[signRecord] export lesson detail fileName =", fileName);
    this.copyCsvToClipboard(csvText, "本次课明细CSV已复制，可直接粘贴到表格");
  },

  /**
   * 加载班级花名册
   * 从 classes 集合获取 roster 数组，构建初始列表
   */
  async loadRoster() {
    const cid = this.data.classId;
    const lessonId = this.data.lessonId;
    console.log("[signRecord] page params", { classId: cid, lessonId });
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

      console.log("[signRecord] cloud roster count", cloudCount);

      if (!Array.isArray(students) || students.length === 0) {
        const localStudents = wx.getStorageSync(`students_${cid}`) || [];
        console.log("[signRecord] local roster fallback count", localStudents.length);
        students = localStudents;
      }

      const list = students
        .map((student) => this.normalizeRosterItem(student))
        .filter((item) => item.name);
      console.log("[signRecord] final roster list count", list.length);
      const baseRosterList = list.map((item) => ({ ...item }));
      this.setData({
        baseRosterList,
        list: baseRosterList.map((item) => ({ ...item }))
      });
      this.refreshSignedStudents();
      this.refreshExportDisabledState();
      this.refreshStats();
    } catch (err) {
      console.error("加载花名册失败：", err);
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

    console.log("[signRecord] query classId =", classId);
    this.setData({ lessonsLoading: true });
    this.refreshExportDisabledState();

    try {
      const res = await wx.cloud.callFunction({
        name: "getLessonsByClass",
        data: { classId }
      });
      const lessons = res.result?.success ? (res.result.lessons || []) : [];
      console.log("[signRecord] lessons result count =", lessons.length);
      this.setData({ lessons });
      this.refreshExportDisabledState();
      console.log("[signRecord] lessons count", lessons.length);
      return lessons;
    } catch (err) {
      console.error("[signRecord] load lessons failed", {
        classId,
        err
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
    const currentLessonId = String(this.data.lessonId || "").trim();
    const selectedLessonId = String(this.data.selectedLessonId || "").trim();
    const candidateLessonId = selectedLessonId || currentLessonId;

    if (candidateLessonId) {
      const matched = lessons.some((lesson) => String(lesson._id || "").trim() === candidateLessonId);
      if (matched || lessons.length === 0) {
        return candidateLessonId;
      }
    }

    return String(lessons[0]?._id || "").trim();
  },

  async switchLesson(lessonId) {
    const nextLessonId = String(lessonId || "").trim();
    if (!nextLessonId) {
      this.clearAttendancePolling();
      const list = this.cloneBaseRosterList();
      this.setData({
        lessonId: "",
        selectedLessonId: "",
        currentStats: null,
        list
      });
      await this.refreshInteractionDataAfterLessonChange();
      this.refreshExportDisabledState();
      this.refreshStats();
      return;
    }

    this.clearAttendancePolling();

    const baseList = this.cloneBaseRosterList();
    this.setData({
      lessonId: nextLessonId,
      selectedLessonId: nextLessonId,
      currentStats: (this.data.stats || []).find(item => item.lessonId === nextLessonId) || null,
      list: baseList
    });
    await this.refreshInteractionDataAfterLessonChange();
    this.refreshExportDisabledState();
    this.refreshStats();

    await this.fetchAttendanceOnce(nextLessonId);
    this.startAttendancePolling(nextLessonId);
    await this.loadStats();
  },

  onSelectLesson(e) {
    const lessonId = String(e.currentTarget.dataset.lessonId || "").trim();
    if (!lessonId || lessonId === this.data.selectedLessonId) return;
    this.switchLesson(lessonId);
  },

  async fetchAttendanceOnce(targetLessonId = "") {
    const lessonId = String(targetLessonId || "").trim();
    const classId = String(this.data.classId || "").trim();
    console.log("[signRecord] fetch attendance start", {
      classId,
      lessonId
    });

    if (!lessonId) {
      console.log("[signRecord] skip fetch attendance: lessonId is empty");
      return;
    }

    if (!classId) {
      console.log("[signRecord] skip fetch attendance: classId is empty");
      return;
    }

    try {
      const res = await db.collection("attendance")
        .where({ lessonId })
        .get();
      const docs = res.data || [];
      console.log("[signRecord] fetch attendance docs count", docs.length);
      this.syncAttendance(docs);
    } catch (err) {
      console.error("[signRecord] fetch attendance failed", {
        classId,
        lessonId,
        err
      });
    }
  },

  startAttendancePolling(targetLessonId = "") {
    const lessonId = String(targetLessonId || "").trim();
    const classId = String(this.data.classId || "").trim();

    if (!lessonId) {
      console.log("[signRecord] skip polling: lessonId is empty");
      return;
    }

    if (!classId) {
      console.log("[signRecord] skip polling: classId is empty");
      return;
    }

    this.clearAttendancePolling();

    this.attendancePollingLessonId = lessonId;
    this.attendancePollingTimer = setInterval(() => {
      this.fetchAttendanceOnce(lessonId);
    }, 3000);

    console.log("[signRecord] polling started", {
      classId,
      lessonId,
      intervalMs: 3000
    });
  },

  clearAttendancePolling() {
    if (this.attendancePollingTimer) {
      clearInterval(this.attendancePollingTimer);
    }
    this.attendancePollingTimer = null;
    this.attendancePollingLessonId = "";
    console.log("[signRecord] polling cleared");
  },

  async refreshAttendance() {
    await this.fetchAttendanceOnce(this.data.selectedLessonId || this.data.lessonId);
  },

  // 将签到数据同步到当前列表
  syncAttendance(docs) {
    const baseList = this.cloneBaseRosterList();
    const list = this.mergeAttendanceIntoList(baseList, docs);
    console.log("[signRecord] merged list count", list.length);
    this.setData({ list });
    this.refreshSignedStudents();
    this.refreshExportDisabledState();
    this.refreshStats();
  },

  /**
   * 重新计算统计数字
   */
  refreshStats() {
    const list = this.data.list;
    this.setData({
      signCount: list.filter(i => i.status === "signed").length,
      unsignCount: list.filter(i => i.status === "unsigned").length,
      absentCount: list.filter(i => i.status === "absent").length,
      waitCount: list.filter(i => i.status === "leave_wait").length,
      leaveCount: list.filter(i => i.status === "leave_agree").length,
    });
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
