// 随机生成颜色的函数
function getRandomColor() {
  const letters = '0123456789ABCDEF';
  let color = '#';
  for (let i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)];
  }
  return color;
}

// 当页面加载时执行颜色分配逻辑
document.addEventListener("DOMContentLoaded", function() {
  // 遍历所有的主节点
  const mainNodes = document.querySelectorAll(".main-node");  // 假设主节点使用 .main-node 类
  mainNodes.forEach(function(node) {
    const nodeId = node.id;  // 获取节点的 id
    let color = getRandomColor();  // 为该主节点生成随机颜色
    
    // 设置主节点的填充颜色
    node.style.fill = color;
    
    // 查找所有与该节点关联的附节点
    const childNodes = document.querySelectorAll(`.child-of-${nodeId}`);  // 假设附节点使用 `.child-of-<nodeId>` 类
    childNodes.forEach(function(child) {
      child.style.fill = color;  // 设置附节点的颜色
    });
    
    // 查找所有与该节点关联的链接
    const links = document.querySelectorAll(`.link-to-${nodeId}`);  // 假设链接使用 `.link-to-<nodeId>` 类
    links.forEach(function(link) {
      link.style.stroke = color;  // 设置链接的颜色
    });
  });
});
