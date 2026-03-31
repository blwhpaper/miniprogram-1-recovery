const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function getTimestamp(value) {
  const rawValue = value && typeof value.toDate === 'function' ? value.toDate() : value
  const date = rawValue instanceof Date ? rawValue : new Date(rawValue)
  return date instanceof Date && !Number.isNaN(date.getTime()) ? date.getTime() : 0
}

async function listLessonsByClass(classId = '') {
  const normalizedClassId = String(classId || '').trim()
  if (!normalizedClassId) return []

  const pageSize = 100
  let skip = 0
  let hasMore = true
  const lessons = []

  while (hasMore) {
    const res = await db.collection('lessons')
      .where({ classId: normalizedClassId })
      .orderBy('startTime', 'desc')
      .skip(skip)
      .limit(pageSize)
      .get()

    const pageList = Array.isArray(res.data) ? res.data : []
    lessons.push(...pageList)
    hasMore = pageList.length === pageSize
    skip += pageList.length
  }

  lessons.sort((left, right) => {
    return getTimestamp(right.startTime || right.createdAt) - getTimestamp(left.startTime || left.createdAt)
  })

  return lessons
}

exports.main = async (event) => {
  const classId = String(event.classId || '').trim()

  if (!classId) {
    return {
      success: false,
      msg: 'classId is required',
      lessons: []
    }
  }

  try {
    return {
      success: true,
      lessons: await listLessonsByClass(classId)
    }
  } catch (err) {
    return {
      success: false,
      msg: '系统错误: ' + err.message,
      lessons: []
    }
  }
}
