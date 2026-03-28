const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

async function getAllByQuery(collectionName, whereQuery, pageSize = 100) {
  let all = []
  let skip = 0

  while (true) {
    const res = await db.collection(collectionName)
      .where(whereQuery)
      .skip(skip)
      .limit(pageSize)
      .get()

    const list = res.data || []
    all = all.concat(list)

    if (list.length < pageSize) break
    skip += pageSize
  }

  return all
}

exports.main = async (event) => {
  const classId = String(event.classId || '').trim()
  const lessonId = String(event.lessonId || '').trim()
  const includeHistory = event.includeHistory !== false

  if (!classId) {
    return {
      success: false,
      msg: 'classId is required',
      stats: [],
      currentStats: null,
      historyIncluded: includeHistory
    }
  }

  try {
    const classRes = await db.collection('classes').doc(classId).get()
    const roster = Array.isArray(classRes.data?.roster) ? classRes.data.roster : []
    const rosterCount = roster.length

    if (!includeHistory && lessonId) {
      const [lessonRes, attendanceList] = await Promise.all([
        db.collection('lessons').doc(lessonId).get(),
        getAllByQuery('attendance', { lessonId })
      ])

      const lessonCount = {
        signedCount: 0,
        absentCount: 0,
        leaveWaitCount: 0,
        leaveAgreeCount: 0
      }

      ;(attendanceList || []).forEach((item) => {
        const status = String(item.status || item.attendanceStatus || 'unsigned').trim() || 'unsigned'

        if (status === 'signed') {
          lessonCount.signedCount += 1
        } else if (status === 'absent') {
          lessonCount.absentCount += 1
        } else if (status === 'leave_wait') {
          lessonCount.leaveWaitCount += 1
        } else if (status === 'leave_agree') {
          lessonCount.leaveAgreeCount += 1
        }
      })

      const signedCount = Number(lessonCount.signedCount || 0)
      const absentCount = Number(lessonCount.absentCount || 0)
      const leaveWaitCount = Number(lessonCount.leaveWaitCount || 0)
      const leaveAgreeCount = Number(lessonCount.leaveAgreeCount || 0)
      const accountedCount = signedCount + absentCount + leaveWaitCount + leaveAgreeCount
      const unsignedCount = Math.max(rosterCount - accountedCount, 0)

      return {
        success: true,
        stats: [],
        currentStats: {
          lessonId,
          startTime: lessonRes.data?.startTime || null,
          rosterCount,
          signedCount,
          unsignedCount,
          absentCount,
          leaveWaitCount,
          leaveAgreeCount
        },
        historyIncluded: false
      }
    }

    const lessonsRes = await db.collection('lessons')
      .where({ classId })
      .orderBy('startTime', 'desc')
      .get()

    const lessons = lessonsRes.data || []
    const lessonIds = lessons
      .map((lesson) => String(lesson._id || '').trim())
      .filter(Boolean)

    const statsCountByLessonId = new Map()

    if (lessonIds.length > 0) {
      const attendanceList = await getAllByQuery('attendance', {
        lessonId: _.in(lessonIds)
      })

      attendanceList.forEach((item) => {
        const lessonId = String(item.lessonId || '').trim()
        if (!lessonId) return
        const status = String(item.status || item.attendanceStatus || 'unsigned').trim() || 'unsigned'
        const current = statsCountByLessonId.get(lessonId) || {
          signedCount: 0,
          absentCount: 0,
          leaveWaitCount: 0,
          leaveAgreeCount: 0
        }

        if (status === 'signed') {
          current.signedCount += 1
        } else if (status === 'absent') {
          current.absentCount += 1
        } else if (status === 'leave_wait') {
          current.leaveWaitCount += 1
        } else if (status === 'leave_agree') {
          current.leaveAgreeCount += 1
        }

        statsCountByLessonId.set(lessonId, current)
      })
    }

    const stats = lessons.map((lesson) => {
      const lessonId = String(lesson._id || '').trim()
      const lessonCount = statsCountByLessonId.get(lessonId) || {
        signedCount: 0,
        absentCount: 0,
        leaveWaitCount: 0,
        leaveAgreeCount: 0
      }
      const signedCount = Number(lessonCount.signedCount || 0)
      const absentCount = Number(lessonCount.absentCount || 0)
      const leaveWaitCount = Number(lessonCount.leaveWaitCount || 0)
      const leaveAgreeCount = Number(lessonCount.leaveAgreeCount || 0)
      const accountedCount = signedCount + absentCount + leaveWaitCount + leaveAgreeCount
      const unsignedCount = Math.max(rosterCount - accountedCount, 0)

      return {
        lessonId,
        startTime: lesson.startTime || null,
        rosterCount,
        signedCount,
        unsignedCount,
        absentCount,
        leaveWaitCount,
        leaveAgreeCount
      }
    })

    return {
      success: true,
      stats,
      currentStats: lessonId
        ? (stats.find((item) => String(item.lessonId || '').trim() === lessonId) || null)
        : null,
      historyIncluded: true
    }
  } catch (err) {
    return {
      success: false,
      msg: '系统错误: ' + err.message,
      stats: [],
      currentStats: null,
      historyIncluded: includeHistory
    }
  }
}
