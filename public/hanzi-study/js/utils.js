// # 浏览器-storage封装
function getStorage(key) {
  let result = localStorage.getItem(key)
  try {
    return JSON.parse(result)
  } catch {
    return result
  }
}
function setStorage(key, val) {
  if (!val && val !== 0 && val !== false) return localStorage.removeItem(key)
  localStorage.setItem(key, JSON.stringify(val))
}
function delStorage(key) {
  localStorage.removeItem(key)
}

function playAudio(type) {
  return new Audio(`./audio/${type}.mp3`).play()
}

function myAlert(msg, timeout) {
  if (!timeout) return alert(msg)
  setTimeout(() => alert(msg), timeout)
}

function loadScripts() {
  const script = document.createElement('script')
  script.src = 'js/lib/dataWriter.js'
  document.body.appendChild(script)
}

 function speakText(text, times, rate, pitch) {
    if (window.speechSynthesis) {
        times = times || 1;
        rate = rate || 0.7;
        pitch = pitch || 1;
        const utterance = new SpeechSynthesisUtterance(new Array(times).fill(text).join(", 。 "));
        utterance.lang = "zh-CN";
        utterance.rate = rate; // 语速（0.1-10，默认1）
        utterance.pitch = pitch; // 音高（0-2，默认1）
        // volume：音量（0-1，默认1）
        speechSynthesis.speak(utterance);
    } else {
        alert("您的浏览器不支持语音合成功能，推荐使用谷歌浏览器。");
    }
}

function listHanzi(target, val, size) {
  console.log('listHanzi..', target, val, size);
  target.innerHTML = ''
  size = size || 75
  val && val.trim() && myCharDataLoader(val, (data) => {
    for (var i = 0; i < data.strokes.length; i++) {
      var strokesPortion = data.strokes.slice(0, i + 1);
      renderFanningStrokes(target, strokesPortion, size);
    }
  })
}

function renderFanningStrokes(target, strokes, size) {
  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.style = `width: ${size}px; height: ${size}px; border: 1px solid #EEE; margin-right: 3px`
  target.appendChild(svg);
  var group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  var transformData = HanziWriter.getScalingTransform(size, size);
  group.setAttributeNS(null, 'transform', transformData.transform);
  svg.appendChild(group);

  strokes.forEach(function (strokePath, ind) {
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttributeNS(null, 'd', strokePath);
    path.style.fill = '#555';
    if (ind === strokes.length - 1) path.style.fill = '#ff6347'; // 最后一个笔画不填充颜色（即不闭合路径
    group.appendChild(path);
  });
}

function aniHanzi(target, val, size) {
  target.innerHTML = ''
  size = size || 150
  let writer = HanziWriter.create(target, val, {
    charDataLoader: myCharDataLoader,
    width: 150,
    height: 150,
    showCharacter: false,
    padding: 5,
    strokeAnimationSpeed: 1, // 动画速度
    delayBetweenStrokes: 500, // 每个笔画之间的间隔时间 ms
  });
  writer.loopCharacterAnimation();
}

function writeHanzi(target, val, size, callback) {
  target.innerHTML = ''
  size = size || 150
  let writer = HanziWriter.create(target, val, {
    charDataLoader: myCharDataLoader,
    width: 150,
    height: 150,
    showCharacter: false,
    showHintAfterMisses: 2,
    padding: 5,
  });
  writer.quiz({
    onCorrectStroke: function(strokeData) {
      console.log(strokeData);
      callback && callback(strokeData, strokeData.strokeNum + 1, strokeData.strokeNum + 1 + strokeData.strokesRemaining);
    },
    // onComplete: function(summaryData) {}
  });
}

function myCharDataLoader(char, onComplete) {
  if (writerData[char]) {
      console.log(`匹配到了本地${char}的笔画数据`);
      onComplete(writerData[char]);
    } else {
      console.log(`本地没有<b> ${char} </b>的笔画数据，正在加载...`);
      HanziWriter.loadCharacterData(char).then(data => {
        if (!data) return
        writerData[char] = data;
        // 最好也本地缓存一下新的笔画数据，不然每次都要重新加载一次
        onComplete(writerData[char]);
      }); 
    }
}

window.dnotifyTimer = null
function dnotify(txt, time) {
  clearTimeout(dnotifyTimer)
  if (document.getElementById('dnotify')) {
    document.getElementById('dnotify').innerHTML = txt
    document.getElementById('dnotify').style.display = 'block';
  } else {
    var notEle = document.createElement('div');
    notEle.id = 'dnotify'
    notEle.innerHTML = txt;
    notEle.style = `display: flex; min-width: 330px;max-width: 40%; padding: 6px 12px 6px 12px; color:#333; box-sizing: border-box; border: 1px solid #ebeef5; 
    position: fixed; background-color: #fff; top:10px;right:10px;z-index: 9999999; box-shadow: 0 2px 12px 0 rgba(0,0,0,.1); text-align: center;justify-content: center;
    transition: opacity .3s,transform .3s,left .3s,right .3s,top .4s,bottom .3s;  overflow: hidden;font-size: 14px;line-height: 1.4; border-radius: 8px; `
    document.body.append(notEle)
  } 
  dnotifyTimer = setTimeout(function(){ document.getElementById('dnotify').style.display = 'none'; }, time ? time : 3000)
}

function getRandomColor(maxRGBValue = 180) {
    // 确保 maxRGBValue 在合理范围内
    maxRGBValue = Math.min(255, Math.max(0, maxRGBValue));

    // 生成红、绿、蓝分量，每个分量都在 0 到 maxRGBValue 之间
    const r = Math.floor(Math.random() * (maxRGBValue + 1));
    const g = Math.floor(Math.random() * (maxRGBValue + 1));
    const b = Math.floor(Math.random() * (maxRGBValue + 1));

    // 将RGB值转换为十六进制字符串，并确保是两位数
    const toHex = (c) => {
        const hex = c.toString(16);
        return hex.length === 1 ? '0' + hex : hex;
    };

    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// var writer = HanziWriter.create('docs-target-7', '测', {
//   width: 150,
//   height: 150,
//   showCharacter: false,
//   showHintAfterMisses: 3,
//   padding: 5,
//   strokeAnimationSpeed: 1, // 动画速度
//   delayBetweenStrokes: 500, // 每个笔画之间的间隔时间 ms
// });
// writer.quiz();
// document.getElementById('docs-target-7-button').addEventListener('click', function () {
//   writer.quiz();
// });
// document.getElementById('animate-button').addEventListener('click', function() {
//   writer.animateCharacter();
// });