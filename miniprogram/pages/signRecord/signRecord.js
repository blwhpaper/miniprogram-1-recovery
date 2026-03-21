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
    list: [], // 最终展示的混合列表
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
          list
        });
        this.refreshStats();
      }
      await this.loadStats();
    } finally {
      wx.hideLoading();
    }
  },

  async loadStats() {
    try {
      const res = await wx.cloud.callFunction({
        name: "getLessonStatsByClass",
        data: { classId: this.data.classId }
      });

      if (res.result && res.result.success) {
        const stats = res.result.stats || [];
        this.setData({ stats });

        const current = stats.find(item => item.lessonId === this.data.lessonId);
        if (current) {
          this.setData({ currentStats: current });
        } else {
          this.setData({ currentStats: null });
        }
      }
    } catch (err) {
      console.error("[signRecord] loadStats failed", err);
    }
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
      return [];
    }

    console.log("[signRecord] query classId =", classId);
    this.setData({ lessonsLoading: true });

    try {
      const res = await wx.cloud.callFunction({
        name: "getLessonsByClass",
        data: { classId }
      });
      const lessons = res.result?.success ? (res.result.lessons || []) : [];
      console.log("[signRecord] lessons result count =", lessons.length);
      this.setData({ lessons });
      console.log("[signRecord] lessons count", lessons.length);
      return lessons;
    } catch (err) {
      console.error("[signRecord] load lessons failed", {
        classId,
        err
      });
      this.setData({ lessons: [] });
      return [];
    } finally {
      this.setData({ lessonsLoading: false });
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
    this.refreshStats();

    await this.fetchAttendanceOnce(nextLessonId);
    this.startAttendancePolling(nextLessonId);
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
