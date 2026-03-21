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

  if (!classId) {
    return {
      success: false,
      msg: 'classId is required',
      stats: []
    }
  }

  try {
    const classRes = await db.collection('classes').doc(classId).get()
    const roster = Array.isArray(classRes.data?.roster) ? classRes.data.roster : []
    const rosterCount = roster.length

    const lessonsRes = await db.collection('lessons')
      .where({ classId })
      .orderBy('startTime', 'desc')
      .get()

    const lessons = lessonsRes.data || []
    const lessonIds = lessons
      .map((lesson) => String(lesson._id || '').trim())
      .filter(Boolean)

    const signedCountByLessonId = new Map()

    if (lessonIds.length > 0) {
      const attendanceList = await getAllByQuery('attendance', {
        lessonId: _.in(lessonIds)
      })

      attendanceList.forEach((item) => {
        const lessonId = String(item.lessonId || '').trim()
        if (!lessonId) return
        signedCountByLessonId.set(
          lessonId,
          (signedCountByLessonId.get(lessonId) || 0) + 1
        )
      })
    }

    const stats = lessons.map((lesson) => {
      const lessonId = String(lesson._id || '').trim()
      const signedCount = signedCountByLessonId.get(lessonId) || 0
      const unsignedCount = Math.max(rosterCount - signedCount, 0)

      return {
        lessonId,
        startTime: lesson.startTime || null,
        rosterCount,
        signedCount,
        unsignedCount
      }
    })

    return {
      success: true,
      stats
    }
  } catch (err) {
    return {
      success: false,
      msg: '系统错误: ' + err.message,
      stats: []
    }
  }
}