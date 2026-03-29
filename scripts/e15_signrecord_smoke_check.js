#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const targetFile = path.join(__dirname, "..", "miniprogram", "pages", "signRecord", "signRecord.js");
const source = fs.readFileSync(targetFile, "utf8");

const checks = [
  {
    name: "ensureRuntimeCaches exists",
    test: /ensureRuntimeCaches\(\)\s*\{[\s\S]*attendanceCacheByLesson[\s\S]*lessonEventCacheByLesson[\s\S]*latestAttendanceSignature[\s\S]*recentAnswerScoreKeys[\s\S]*\}/
  },
  {
    name: "onLoad initializes runtime caches",
    test: /onLoad\(options\)\s*\{\s*this\.ensureRuntimeCaches\(\);/
  },
  {
    name: "initData initializes runtime caches",
    test: /async initData\(\)\s*\{\s*this\.ensureRuntimeCaches\(\);/
  },
  {
    name: "switchLesson initializes runtime caches",
    test: /async switchLesson\(lessonId\)\s*\{\s*this\.ensureRuntimeCaches\(\);/
  },
  {
    name: "fetchAttendanceOnce initializes runtime caches",
    test: /async fetchAttendanceOnce\(targetLessonId = "", options = \{\}\)\s*\{\s*this\.ensureRuntimeCaches\(\);/
  },
  {
    name: "loadLessonEvents initializes runtime caches",
    test: /async loadLessonEvents\(options = \{\}\)\s*\{\s*this\.ensureRuntimeCaches\(\);/
  },
  {
    name: "attendance cache uses Map get/set consistently",
    test: /attendanceCacheByLesson: new Map\(\)[\s\S]*attendanceCacheByLesson\.get\([\s\S]*attendanceCacheByLesson\.set\(/
  },
  {
    name: "lessonEvent cache uses Map get/set consistently",
    test: /lessonEventCacheByLesson: new Map\(\)[\s\S]*lessonEventCacheByLesson\.get\([\s\S]*lessonEventCacheByLesson\.set\(/
  },
  {
    name: "switchLesson prefers cache for attendance and lesson events",
    test: /fetchAttendanceOnce\(nextLessonId,\s*\{\s*preferCache:\s*true\s*\}\)[\s\S]*loadLessonEvents\(\{\s*silent:\s*true,\s*lessonId:\s*nextLessonId,\s*preferCache:\s*true\s*\}\)/
  },
  {
    name: "polling starts after switchLesson hydration requests",
    test: /await Promise\.all\(\[[\s\S]*fetchAttendanceOnce\(nextLessonId[\s\S]*loadLessonEvents\([\s\S]*\]\);[\s\S]*startAttendancePolling\(nextLessonId\);[\s\S]*startLessonEventPolling\(nextLessonId\);/
  }
];

let failed = 0;

checks.forEach((check) => {
  if (check.test.test(source)) {
    console.log(`PASS: ${check.name}`);
    return;
  }
  failed += 1;
  console.log(`FAIL: ${check.name}`);
});

if (failed > 0) {
  console.error(`\nE15 signRecord smoke check failed: ${failed} check(s) missing`);
  process.exit(1);
}

console.log("\nE15 signRecord smoke check passed");
