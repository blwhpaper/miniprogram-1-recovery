const cloud = require('wx-server-sdk')
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})
const db = cloud.database()
const AUTO_END_AFTER_MS = 115 * 60 * 1000

function getTimestamp(value) {
  const rawValue = value && typeof value.toDate === 'function' ? value.toDate() : value
  const date = rawValue instanceof Date ? rawValue : new Date(rawValue)
  return date instanceof Date && !Number.isNaN(date.getTime()) ? date.getTime() : 0
}

exports.main = async (event) => {
  try {
    const wxContext = cloud.getWXContext()
    const env = String(wxContext.ENV || process.env.TCB_ENV || process.env.SCF_NAMESPACE || "").trim()
    const lessonId = String(event.lessonId || event._id || "").trim();
    const scene = lessonId || "default_lesson";
    const page = "pages/studentHome/studentHome"
    const allowedEnvVersions = ['develop', 'trial', 'release']
    const envVersion = allowedEnvVersions.includes(event.envVersion)
      ? event.envVersion
      : 'develop'

    console.log("[createSignCode][CHECK] request", {
      lessonId,
      env,
      page,
      scene,
      envVersion
    })

    if (!lessonId) {
      throw new Error("lessonId is required")
    }

    const lessonRes = await db.collection('lessons').doc(lessonId).get()
    const lesson = lessonRes.data || null
    if (!lesson) {
      throw new Error("当前课不存在")
    }

    const status = String(lesson.status || '').trim()
    const startTimestamp = getTimestamp(lesson.startTime || lesson.createdAt)
    const shouldAutoEnd = startTimestamp && Date.now() >= startTimestamp + AUTO_END_AFTER_MS

    if (status !== 'active' || shouldAutoEnd) {
      if (shouldAutoEnd && lessonId) {
        await db.collection('lessons').doc(lessonId).update({
          data: {
            status: 'ended',
            endTime: db.serverDate(),
            autoEnded: true
          }
        })
      }
      throw new Error("当前课已结束，无法继续生成签到码")
    }

    const result = await cloud.openapi.wxacode.getUnlimited({
      page,
      scene: scene,
      width: 280,
      env_version: envVersion,
      check_path: false
    })

    return {
      success: true,
      buffer: result.buffer,
      page,
      scene: scene,
      envVersion: envVersion,
      env
    }

  } catch (err) {
    console.error("生成二维码失败：", err)
    return { 
      success: false,
      err: err 
    }
  }
}
