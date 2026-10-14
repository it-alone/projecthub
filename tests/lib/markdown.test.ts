import { describe, expect, it } from "vitest";
import { renderMarkdown } from "~/lib/markdown";

describe("renderMarkdown（零依赖安全渲染器）", () => {
  it("标题与段落：# ~ ###### 映射 h1~h6，段落单换行渲染为 <br>", () => {
    expect(renderMarkdown("# 标题一")).toBe("<h1>标题一</h1>");
    expect(renderMarkdown("###### 六级")).toBe("<h6>六级</h6>");
    expect(renderMarkdown("第一行\n第二行")).toBe("<p>第一行<br />第二行</p>");
  });

  it("空输入与纯空白返回空串", () => {
    expect(renderMarkdown("")).toBe("");
    expect(renderMarkdown(" \n \n")).toBe("");
  });

  it("行内元素：粗体/斜体/删除线/行内代码", () => {
    expect(renderMarkdown("**粗**")).toBe("<p><strong>粗</strong></p>");
    expect(renderMarkdown("__粗__")).toBe("<p><strong>粗</strong></p>");
    expect(renderMarkdown("*斜*")).toBe("<p><em>斜</em></p>");
    expect(renderMarkdown("~~删~~")).toBe("<p><del>删</del></p>");
    expect(renderMarkdown("`code`")).toBe("<p><code>code</code></p>");
    // 行内代码内不再解析 Markdown
    expect(renderMarkdown("`**不是粗体**`")).toBe("<p><code>**不是粗体**</code></p>");
    // 下划线斜体不误伤 snake_case
    expect(renderMarkdown("some_var_name")).toBe("<p>some_var_name</p>");
  });

  it("HTML 全量转义：脚本与标签不逃逸（XSS 防线）", () => {
    expect(renderMarkdown("<script>alert(1)</script>")).not.toContain("<script");
    expect(renderMarkdown("<img src=x onerror=alert(1)>")).not.toContain("<img");
    expect(renderMarkdown("a < b & c > d")).toContain("&lt; b &amp; c &gt;");
  });

  it("链接与图片：白名单协议放行，javascript: 降级为 #", () => {
    expect(renderMarkdown("[站点](https://example.com)")).toContain(
      '<a href="https://example.com" target="_blank" rel="noreferrer noopener">站点</a>',
    );
    expect(renderMarkdown("[相对](/docs/a)")).toContain('href="/docs/a"');
    expect(renderMarkdown("[坏](javascript:alert(1))")).toContain('href="#"');
    expect(renderMarkdown("![图](https://e.com/x.png)")).toContain('<img src="https://e.com/x.png"');
    expect(renderMarkdown("![坏图](javascript:alert(1))")).toContain('src="#"');
  });

  it("围栏代码块：保留原文（转义后）、不解析内部 Markdown、支持语言标记", () => {
    const html = renderMarkdown("```ts\nconst a = '<b>';\n**not bold**\n```");
    expect(html).toContain("<pre><code class=\"language-ts\">");
    expect(html).toContain("const a = &#39;&lt;b&gt;&#39;;");
    expect(html).toContain("**not bold**");
    expect(html).not.toContain("<strong>");
  });

  it("分隔线：--- /***/___ 均渲染 <hr>", () => {
    expect(renderMarkdown("---")).toBe("<hr />");
    expect(renderMarkdown("***")).toBe("<hr />");
    expect(renderMarkdown("___")).toBe("<hr />");
  });

  it("引用：递归渲染内部结构", () => {
    const html = renderMarkdown("> 引用一行\n> # 引用中的标题");
    expect(html).toBe("<blockquote><p>引用一行</p><h1>引用中的标题</h1></blockquote>");
  });

  it("列表：无序/有序/任务项/嵌套", () => {
    expect(renderMarkdown("- 甲\n- 乙")).toBe("<ul><li>甲</li><li>乙</li></ul>");
    expect(renderMarkdown("1. 一\n2. 二")).toBe("<ol><li>一</li><li>二</li></ol>");
    const task = renderMarkdown("- [ ] 待办\n- [x] 完成");
    expect(task).toContain('class="md-task"');
    expect(task).toContain("checked");
    // 任务项下的嵌套列表不能丢（曾因任务分支忽略续行而整段丢失）
    const taskNested = renderMarkdown("- [ ] 写接口\n  - GET /api/docs\n  - POST /api/docs");
    expect(taskNested).toContain(
      '<li class="md-task"><input type="checkbox" disabled /> 写接口<ul><li>GET /api/docs</li><li>POST /api/docs</li></ul></li>',
    );
    const nested = renderMarkdown("- 甲\n  - 乙\n    - 丙");
    expect(nested).toBe("<ul><li>甲<ul><li>乙<ul><li>丙</li></ul></li></ul></li></ul>");
  });

  it("表格：表头/表体/对齐/转义竖线", () => {
    const html = renderMarkdown("| 左 | 中 | 右 |\n| --- | :---: | ---: |\n| a | b | c |");
    expect(html).toContain("<table><thead><tr><th>左</th>");
    expect(html).toContain('style="text-align: center"');
    expect(html).toContain('style="text-align: right"');
    expect(html).toContain("<td>a</td>");
    expect(renderMarkdown("| a \\| b | c |\n| --- | --- |")).toContain("<th>a | b</th>");
  });

  it("块级组合：空行分隔互不吞并", () => {
    const html = renderMarkdown("# 题\n\n段落\n\n- 项\n\n尾段");
    expect(html).toContain("<h1>题</h1>");
    expect(html).toContain("<p>段落</p>");
    expect(html).toContain("<ul><li>项</li></ul>");
    expect(html).toContain("<p>尾段</p>");
  });
});
