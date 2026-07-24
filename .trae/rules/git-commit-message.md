---
alwaysApply: true
scene: git_message
language: zh
---

## commit message 格式

`type(scope): subject`

### type（必须）

用于说明 commit 的类别，只允许使用下面的标识：

| type     | 说明                                                             |
| -------- | ---------------------------------------------------------------- |
| feat     | 新功能（feature）                                                |
| fix      | 修复 bug，一次提交直接修复问题                                   |
| to       | 只产生 diff 不自动修复，适合多次提交逐步修复。最终修复时使用 fix |
| doc      | 文档（documentation）                                            |
| style    | 格式（不影响代码运行的变动）                                     |
| refactor | 重构（既不是新增功能，也不是修改 bug 的代码变动）                |
| perf     | 优化相关，比如提升性能、体验                                     |
| test     | 增加测试                                                         |
| chore    | 构建过程或辅助工具的变动                                         |
| revert   | 回滚到上一个版本                                                 |
| merge    | 代码合并                                                         |
| sync     | 同步主线或分支的 bug                                             |

### scope（可选）

此部分使用 **英文**，用于说明 commit 影响的范围，比如数据层、控制层、视图层等，视项目不同而不同。

如果修改影响了不止一个 scope，可以使用 `*` 代替。

### subject（必须）

commit 目的的简短描述，不超过 50 个字符。

- 建议使用中文
- 结尾不加句号或其他标点符号

### 示例

```text
fix(DAO): 用户查询缺少username属性
feat(Controller): 用户查询接口开发
```

### message 内容（可选）

格式：

```text
- 修复用户查询缺少username属性的问题
- 新增用户查询接口
```
