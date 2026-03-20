const cloud = require('wx-server-sdk')
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

exports.main = async (event) => {
  try {
    const scene = event.lessonId || "default_lesson";
    const page = "pages/studentSign/studentSign"
    const allowedEnvVersions = ['develop', 'trial', 'release']
    const envVersion = allowedEnvVersions.includes(event.envVersion)
      ? event.envVersion
      : 'develop'

    console.log("[createSignCode][CHECK] request", {
      lessonId: event.lessonId || "",
      page,
      scene,
      envVersion
    })

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
      envVersion: envVersion
    }

  } catch (err) {
    console.error("生成二维码失败：", err)
    return { 
      success: false,
      err: err 
    }
  }
}
