const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

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
    const res = await db.collection('lessons')
      .where({ classId })
      .orderBy('startTime', 'desc')
      .get()

    return {
      success: true,
      lessons: res.data || []
    }
  } catch (err) {
    return {
      success: false,
      msg: '系统错误: ' + err.message,
      lessons: []
    }
  }
}
