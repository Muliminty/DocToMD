const readline = require('readline');
const axios = require('axios');
const TurndownService = require('turndown');
const fs = require('fs');
const cheerio = require('cheerio');
const path = require('path');
const https = require('https');
const url = require('url');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const turndownService = new TurndownService();

function sanitizeFilename(input) {
  let output;
  try {
    output = input
      .replace(/\\/g, '_')
      .replace(/\//g, '_')
      .replace(/:/g, '_')
      .replace(/\*/g, '_')
      .replace(/\?/g, '_')
      .replace(/"/g, '_')
      .replace(/</g, '_')
      .replace(/>/g, '_')
      .replace(/\|/g, '_')
      .replace(/\n/g, '_') // 添加这一行来处理换行符
      .replace(/\r/g, '_'); // 添加这一行来处理回车符
  } catch (error) {
    output = "名称解析失败";
  }
  return output;
}

rl.question('请输入文档地址：', (answer) => {
  try {
    new URL(answer);
  } catch (error) {
    console.error('无效的 URL');
    return;
  }

  turndownService.addRule('relativeLink', {
    filter: 'a',
    replacement: function (content, node) {
      const href = node.getAttribute('href');
      if (href) {
        const absoluteHref = new URL(href, answer).href;
        return '[' + content + '](' + absoluteHref + ')';
      } else {
        return content;
      }
    }
  });

  turndownService.addRule('codeBlock', {
    filter: function (node) {
      return node.nodeName === 'CODE' && node.parentNode.nodeName === 'PRE';
    },
    replacement: function (content) {
      // 使用 Markdown 的代码块语法
      return '```\n' + content + '\n```';
    }
  });

  axios.get(answer)
    .then(response => {
      const html = response.data;
      const $ = cheerio.load(html);
      let title = $('h1').first().text();
      if (!title) {
        title = $('title').text();
      }
      title = sanitizeFilename(`${title}-${new Date().getTime()}`);

      // 解析 JSON-LD 数据
      const jsonLd = JSON.parse($('script[type="application/ld+json"]').html());

      // 创建一个 Markdown 表格
      let table = '| 属性 | 值 |\n| --- | --- |\n';
      for (const key in jsonLd) {
        if (jsonLd.hasOwnProperty(key)) {
          let value = jsonLd[key];
          if (Array.isArray(value)) {
            value = value.join(', ');
          }
          table += `| ${key} | ${value} |\n`;
        }
      }

      // 检查是否存在 main 标签
      let content;
      if ($('main').length) {
        content = $('main').html();
      } else {
        content = html;
      }

      // 将表格添加到 Markdown 的开头
      const markdown = table + '\n' + turndownService.turndown(content);

      const dir = `doc/${title}`;
      const imgDir = path.join(dir, 'image');

      // 创建文件夹（如果它不存在）
      fs.mkdir(dir, { recursive: true }, (err) => {
        if (err) {
          console.error('创建目录时发生错误: ', err);
          return;
        }

        // 将 Markdown 保存到文件夹下的文件
        const filename = `${dir}/markdown.md`;
        fs.writeFile(filename, markdown, (err) => {
          if (err) {
            console.error('写入文件时发生错误: ', err);
          } else {
            console.log(`Markdown 已保存到 ${filename}`);
          }
        });

        // 创建 image 文件夹（如果它不存在）
        fs.mkdir(imgDir, { recursive: true }, (err) => {
          if (err) {
            console.error('创建 image 目录时发生错误: ', err);
            return;
          }

          // 下载并保存所有图片
          $('img').each((i, elem) => {
            const imgSrc = url.resolve(answer, $(elem).attr('src'));
            const imgFilename = path.join(imgDir, path.basename(imgSrc));
            const file = fs.createWriteStream(imgFilename);
            https.get(imgSrc, (response) => {
              response.pipe(file);
            });
          });
        });
      });
    })
    .catch(error => {
      console.log('error: ', error);
    });

  rl.close();
});