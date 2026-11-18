import { Howl } from "howler";
import PluginModel from "../../models/Plugin";
import { getAllVoices, getFormatFromAudioPath } from "../common";
import { getTTSAudio } from "../request/reader";
import { isElectron } from "react-device-detect";

class TTSUtil {
  static player: any;
  static audioPaths: { index: number; audioPath: string }[] = [];
  static isPaused: boolean = false;
  static pausedMidSentence: boolean = false;
  static processingIndexes: Set<number> = new Set();
  static async readAloud(currentIndex: number) {
    // 清理比当前 index 小 10 的已朗读缓存
    this.audioPaths = this.audioPaths.filter(
      (item) => item.index >= currentIndex - 10
    );
    return new Promise<string>(async (resolve) => {
      let audioPath = this.audioPaths.find(
        (item) => item.index === currentIndex
      )?.audioPath;
      if (!audioPath) {
        resolve("loaderror");
        return;
      }
      var sound = new Howl({
        src: [audioPath],
        format: [getFormatFromAudioPath(audioPath)],
        onloaderror: () => {
          resolve("loaderror");
        },
        onload: async () => {
          this.player.play();
          resolve("load");
        },
      });
      this.player = sound;
    });
  }
  static async cacheAudio(
    startIndex: number,
    speed: number,
    plugins: PluginModel[],
    audioNodeList: {
      text: string;
      voiceName: string;
      voiceEngine: string;
    }[],
    targetCacheCount: number,
    isFirst: boolean,
    isOfficialAIVoice: boolean
  ) {
    this.isPaused = false;

    if (isOfficialAIVoice) {
      const cacheCount = Math.min(
        targetCacheCount,
        audioNodeList.length - startIndex
      );
      // 并发执行，并发数量为3，但保证添加顺序
      const CONCURRENT_LIMIT = 10;
      //删除index小于startIndex的缓存
      this.audioPaths = this.audioPaths.filter(
        (item) => item.index >= startIndex - 5
      );

      for (let i = 0; i < cacheCount; i += CONCURRENT_LIMIT) {
        const batch: any[] = [];

        for (let j = 0; j < CONCURRENT_LIMIT && i + j < cacheCount; j++) {
          const index = startIndex + i + j;
          if (index >= audioNodeList.length) break;

          // 如果已经缓存过或正在处理中，跳过
          if (
            this.audioPaths.find((item) => item.index === index) ||
            this.processingIndexes.has(index)
          ) {
            continue;
          }

          // 标记为正在处理
          this.processingIndexes.add(index);

          const audioNode = audioNodeList[index];
          let plugin = plugins.find(
            (item) => item.key === audioNode.voiceEngine
          );
          if (!plugin) {
            return "error";
          }
          let voice = (plugin.voiceList as any[]).find(
            (voice) => voice.name === audioNode.voiceName
          );
          if (!voice) {
            return "error";
          }
          // 创建异步任务
          const task = this.getAudioPath(
            audioNode.text,
            speed,
            audioNode.voiceEngine,
            plugin,
            voice,
            isFirst
          )
            .then(async (res) => {
              // 处理完成后，从处理集合中移除
              this.processingIndexes.delete(index);
              if (res) {
                return { index, audioPath: res };
              } else {
                this.isPaused = true;
                return null;
              }
            })
            .catch((error) => {
              // 出错时也要从处理集合中移除
              this.processingIndexes.delete(index);
              console.error(`Error caching audio for index ${index}:`, error);
              return null;
            });
          batch.push(task);
        }

        // 等待当前批次完成
        const batchResults = await Promise.all(batch);

        // 将结果存储到 Map 中
        for (const result of batchResults) {
          if (result) {
            if (this.audioPaths.find((item) => item.index === result.index)) {
              this.audioPaths = this.audioPaths.map((item) => {
                if (item.index === result.index) {
                  return result;
                } else {
                  return item;
                }
              });
            } else {
              this.audioPaths.push(result);
            }
          } else {
            this.isPaused = true;
            return "error";
          }
        }
      }
    } else {
      let maxCacheIndex = Math.min(
        startIndex + targetCacheCount,
        audioNodeList.length
      );
      for (let index = startIndex; index < maxCacheIndex; index++) {
        if (this.isPaused) {
          break;
        }
        // 如果已经缓存过或正在处理中，跳过
        if (
          this.audioPaths.find((item) => item.index === index) ||
          this.processingIndexes.has(index)
        ) {
          continue;
        }
        // 标记为正在处理
        this.processingIndexes.add(index);
        const audioNode = audioNodeList[index];
        let plugin = plugins.find((item) => item.key === audioNode.voiceEngine);
        if (!plugin) {
          return "error";
        }
        let voice = (plugin.voiceList as any[]).find(
          (voice) => voice.name === audioNode.voiceName
        );
        if (!voice) {
          return "error";
        }
        let audioPath = await this.getAudioPath(
          audioNode.text,
          speed,
          audioNode.voiceEngine,
          plugin,
          voice,
          isFirst
        );
        // 处理完成后，从处理集合中移除
        this.processingIndexes.delete(index);
        if (audioPath) {
          this.audioPaths.push({ index: index, audioPath: audioPath });
        } else {
          this.isPaused = true;
          break;
        }
      }
    }
  }
  static async pauseAudio() {
    if (this.player) {
      this.player.pause();
      this.isPaused = true;
      this.pausedMidSentence = true;
    }
  }
  static resumeAudio(): boolean {
    if (this.player && this.pausedMidSentence) {
      this.player.play();
      this.isPaused = false;
      this.pausedMidSentence = false;
      return true;
    }
    return false;
  }
  static async stopAudio() {
    if (this.player && this.player.stop) {
      this.player.stop();
      this.isPaused = true;
      this.pausedMidSentence = false;
      // 仅清理内存缓存，磁盘上的 tts 目录保留供跨会话复用
      setTimeout(() => {
        this.audioPaths = [];
        this.processingIndexes.clear();
      }, 1000);
    }
  }
  static getAudioPaths() {
    return this.audioPaths;
  }
  static async getAudioPath(
    text: string,
    speed: number,
    voiceEngine: string,
    plugin,
    voice,
    isFirst: boolean
  ) {
    if (voiceEngine === "official-ai-voice-plugin") {
      // 内容哈希：相同文本/语速/音色命中同一文件，跨会话复用（与 expo 端 key 设计一致）
      const audioKeyPayload = {
        text,
        speed,
        voiceIdentifier: `official-ai-${voice.language}-${voice.name}`,
      };
      if (isElectron) {
        // Electron：音频持久缓存到 dirPath/tts 目录，命中本地缓存直接复用
        let cached = await window.electronAPI.invoke(
          "get-cached-tts",
          audioKeyPayload
        );
        if (cached && cached.audioPath) {
          return cached.audioPath;
        }
        let res = await getTTSAudio(
          text,
          voice.language,
          voice.name,
          (speed + 100) / 100,
          1.0,
          isFirst
        );
        if (res && res.data && res.data.audio_base64) {
          return await window.electronAPI.invoke("save-tts-audio", {
            key: cached && cached.key,
            base64: res.data.audio_base64,
          });
        }
        return "";
      }
      // 浏览器：保留 base64 数据 URI 播放
      let res = await getTTSAudio(
        text,
        voice.language,
        voice.name,
        (speed + 100) / 100,
        1.0,
        isFirst
      );
      if (res && res.data && res.data.audio_base64) {
        return res.data.audio_base64;
      }
      return "";
    } else {
      const payload: Record<string, unknown> = {
        text: text,
        speed,
        pluginKey: plugin.key,
        config: voice.config,
      };
      if (plugin.script) {
        payload.script = plugin.script;
        if (plugin.scriptSHA256) {
          payload.scriptSHA256 = plugin.scriptSHA256;
        }
      }
      let audioPath = await window.electronAPI.invoke("generate-tts", payload);
      return audioPath;
    }
  }
  static setAudioPaths() {
    this.audioPaths = [];
    this.processingIndexes.clear();
    this.pausedMidSentence = false;
  }
  static getPlayer() {
    return this.player;
  }
  static getVoiceList(plugins: PluginModel[]) {
    let voices = getAllVoices(plugins);

    return voices;
  }
}
export default TTSUtil;
