---
layout: home

hero:
  name: Charturbo
  text: GPU 加速的 Web 图表库
  tagline: 以 60 FPS 缩放和平移 100 万至 1000 万个数据点。基于 Rust + WebGPU，不支持 WebGPU 时自动回退到 WebGL2。
  actions:
    - theme: brand
      text: 快速开始
      link: /zh/guide/getting-started
    - theme: alt
      text: 图表手册
      link: /zh/charts/line
    - theme: alt
      text: 在线示例
      link: https://jparkk0517.github.io/Charturbo/gallery.html

features:
  - title: 大数据量下依然流畅
    details: M4 降采样、命中检测、堆叠计算和刻度布局均在 Rust（WebAssembly）中完成，并由 GPU 绘制。DOM 只负责标签、图例和提示框。
  - title: 25 种以上图表
    details: 折线图、面积图、柱状图、散点图、K 线图、热力图、箱线图/小提琴图、饼图、雷达图、仪表盘、漏斗图、瀑布图、矩形树图、旭日图、桑基图、迷你图以及 3D 视图。
  - title: 面向真实业务
    details: 实时数据流、时间轴与对数轴、缩放与双指捏合、范围导航器、框选、仪表盘联动，以及 PNG/SVG/PDF 导出。
  - title: 无障碍与多语言
    details: 自动摘要、数据表格和键盘导航，支持英语、韩语和简体中文。
  - title: React 与 Vue
    details: 官方组件，附带完整的 TypeScript 类型。
  - title: 大规模 3D
    details: Barnes-Hut 网络图、嵌入向量投影与余弦相似度检索，以及带刚体物理的 3D 场景。
---
