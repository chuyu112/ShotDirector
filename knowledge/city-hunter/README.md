# 城市猎人逐话剧情资料

这里分开保存两种证据：

1. `download-status.json`：下载进度、来源状态和已落地文件，防止把失败任务误报为完成。
2. `chapter-index.json`：公开网站同步的全336话编号与日文原题；文件生成后只用于识别章节。
3. `episodes/`：由用户实际上传漫画逐页、逐格提炼的剧情梗概；`.md` 供人阅读，`.json` 供程序和 Skill 调用。画格证据优先于外部网页。

公开目录不等于剧情事实。外部资料不得覆盖漫画画格、对白、用户批注和已经确认的跨 Shot 连续性。

更新目录：

```bash
node scripts/sync-city-hunter-chapter-index.mjs
```

来源：

- [ebookjapan《城市猎人 完全版》336话目录](https://ebookjapan.yahoo.co.jp/stories/all/118125/)
- [ZENON PLUS《城市猎人》第4话授权页面](https://comic-zenon.com/episode/14079602755177340361)
- [漫画官方账号逐话短评归档（#毎日CH扉絵）](https://twiman.net/search?m=tweet&o=2&q=%E6%AF%8E%E6%97%A5CH%E6%89%89%E7%B5%B5)

注意：公开短评归档当前对自动读取返回403或空结果，所以没有把未抓到的336话剧情冒充成本地数据。当前已真正落地的是第4话扫描图剧情。
