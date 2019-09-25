//用於 vscode 的名稱解析
import { CompletionItem, CompletionItemKind, SnippetString, Hover, WorkspaceFolder, Location, Uri, Position, MarkdownString, SignatureHelp, SignatureInformation, ParameterInformation } from 'vscode';
//用於檔案讀取的 FileStream 解析
import * as fs from 'fs';
//用於讀取每一行的解析
import { ReadLinesSync } from './utilities/readLines';
//檢查字串是否為空字串
import { isBlank } from './utilities/checkString';
//Script 方法解析與工具
import { ScriptMethod, type2Str, str2Type } from './scriptmethod';

/**
 * 取出變數或方法名稱的 Regex 樣板
 */
const namePat = /\b(?!def|thread|global)\w+/;
/**
 * 取出參數內容的 Regex 樣板
 */
const paramPat = /\((.*?)\)/;

/**
 * 解析文件註解並轉換為可用於 MethodParameter 的物件
 * @param line 欲解析的文件行
 */
function parseDocParam(line: string) {
    /* 將該行利用空白切開 */
    const splitted = line
        .replace('@param', '')
        .trim()
        .split(' ');
    /* 第一筆為參數名稱 */
    const first = splitted.shift();
    const label = first ? first : '';
    /* 第二筆為類型 */
    const type = str2Type(splitted.shift());
    /* 之後的是註解 */
    const comment = splitted.join(' ');
    return {
        "Label": label,
        "Type": type2Str(type),
        "Comment": comment,
        "Default": ''
    };
}

/**
 * 解析文件註解並轉換為描述 Return 之物件
 * @param line 欲解析的文件行
 */
function parseDocReturn(line?: string) {
    if (line) {
        /* 將該行利用空白切開 */
        const splitted = line
            .replace('@returns', '')
            .trim()
            .split(' ');
        /* 第一筆為類型 */
        const type = str2Type(splitted.shift());
        /* 之後的是註解 */
        const comment = splitted.join(' ');
        return {
            "ReturnType": type2Str(type),
            "Return": comment
        };
    }
}

/**
 * 從文字集合中尋找可顯示的註解
 * @param lines 欲查找的文字集合
 * @param name 此方法或變數的名稱
 */
function findDoc(name: string, lines?: string[]): ScriptMethod | undefined {
    /* 確保 lines 有東西且最後一行是註解的結尾 */
    if (lines && lines[lines.length - 1] === '###') {
        /* 因 lines 是 Queue，故從後面往前找 '###' */
        let startIndex = -1;
        let endIndex = lines.length - 1;
        /* 由於一開始已檢查 lines[lines.length - 1] === '###'，故只要從 -2 開始找 start 即可 */
        for (let idx = lines.length - 2; idx >= 0; idx--) {
            if (lines[idx] === '###') {
                startIndex = idx;
                break;
            }
        }
        /* 如果都有找到，轉成 UrDoc */
        if (startIndex > -1 && startIndex < endIndex) {
            /* 移除 '#' 字號並去前後空白，留下有資料的物件即可 */
            const doc = lines
                .slice(startIndex + 1, endIndex)
                .map(l => l.replace(/#/g, '').trim());
            /* 取出有 @param 的片段並組成參數 */
            const params = doc
                .filter(l => l.startsWith('@param'))
                .map(l => parseDocParam(l));
            /* 取出 @returns 片段組成回傳資訊 */
            const returns = parseDocReturn(
                doc.find(l => l.startsWith('@returns'))
            );
            /* 取出沒有 @param 的片段組成 name */
            const summary = doc
                .filter(l => !l.startsWith('@'))
                .join('  \n');
            /* 組合成匿名物件 */
            const info = {
                "Name": name,
                "ReturnType": returns ? returns.ReturnType : 'None',
                "Return": returns ? returns.Return : '',
                "Deprecated": '',
                "Comment": summary,
                "Parameters": params
            };
            /* 回傳物件 */
            return new ScriptMethod(info);
        }
    }
}

/**
 * 將 RegExpExecArray 轉成對應的 CompletionItems
 * @param matchResult 欲轉換的 Regex 比對結果
 * @param cmpItems 欲儲存的完成項目集合
 * @param oldLines 先前已讀過的行暫存
 */
function parseCmpItem(matchResult: RegExpExecArray | null, cmpItems: CompletionItem[], oldLines?: string[]) {
    /* 如果沒東西，直接離開 */
    if (!matchResult || matchResult.length <= 0) {
        return;
    }
    /* 有東西則輪詢將 Regex 結果轉成 CompletionItem */
    matchResult.forEach(
        value => {
            if (value) {
                /* 用 Regex 取得方法名稱 */
                const nameReg = namePat.exec(value);
                /* 有成功找到，建立完成項目 */
                if (nameReg && !cmpItems.find(cmp => cmp.label === nameReg[0])) {
                    /* 建立要回傳的完成項目 */
                    const cmpItem = new CompletionItem(nameReg[0]);
                    cmpItem.commitCharacters = ['\t', ' ', '\n'];
                    /*
                        查看前面有沒有註解，目前預設應該要長成...

                        ###
                        # get digital input
                        # @param n number the input to read
                        # @returns bool input level
                        ###
                    */
                    const doc = findDoc(nameReg[0], oldLines);
                    /* 如果有 doc 則加入 documentation */
                    if (doc) {
                        cmpItem.documentation = doc.Documentation;
                    }
                    /* 依照不同項目撰寫說明 */
                    if (/global/.test(value)) {         //變數
                        cmpItem.kind = CompletionItemKind.Variable;
                        cmpItem.insertText = nameReg[0];
                        cmpItem.detail = `global ${nameReg[0]}`;
                    } else if (/thread/.test(value)) {  //執行緒
                        cmpItem.kind = CompletionItemKind.Variable;
                        cmpItem.insertText = `${nameReg[0]}()`;
                        cmpItem.detail = `thread ${nameReg[0]}`;
                    } else {    //方法
                        cmpItem.kind = CompletionItemKind.Function;
                        /* 如果有 doc，直接用 doc 做即可 */
                        if (doc) {
                            cmpItem.detail = doc.Label;
                            cmpItem.insertText = new SnippetString(doc.Name); //讓使用者等等用 '(' 顯示簽章
                            cmpItem.commitCharacters.push('(');
                        } else {
                            /* 嘗試尋找參數內容 */
                            const paramReg = paramPat.exec(value);
                            /* 如果有參數，列出來 */
                            if (paramReg && paramReg.length > 1 && !isBlank(paramReg[1])) {
                                /* 將參數給拆出來 */
                                const param = paramReg[1].split(',').map(p => p.trim());
                                /* 組合 */
                                cmpItem.detail = `${nameReg[0]}(${param.join(', ')})`;
                                /* 計算 $1~$n */
                                let signIdx = 1;
                                const sign = param.map(p => `\${${signIdx++}:${p}}`);
                                /* 自動填入 */
                                cmpItem.insertText = new SnippetString(`${nameReg[0]}(${sign.join(', ')})$0`);
                            } else {
                                cmpItem.detail = `${nameReg[0]}`;
                                cmpItem.insertText = new SnippetString(`${nameReg[0]}()$0`);
                            }
                        }
                    }
                    /* 將找到的加入集合 */
                    cmpItems.push(cmpItem);
                }
            }
        }
    );
}

/**
 * 將 RegExpExecArray 轉成對應的 Hover
 * @param matchResult 欲轉換的 Regex 比對結果
 * @param oldLines 先前已讀過的行暫存
 */
function parseHover(matchResult: RegExpExecArray | null, oldLines?: string[]): Hover | undefined {
    /* 如果沒東西，直接離開 */
    if (!matchResult || matchResult.length <= 0) {
        return;
    }
    /* 暫存搜尋的結果 */
    const step = matchResult[0];
    /* 用 Regex 取得方法名稱 */
    const nameReg = namePat.exec(step);
    /* 有成功找到，建立完成項目 */
    if (nameReg) {
        /* 建立要儲存 Hover 內容的容器 */
        const items: (MarkdownString | { language: string, value: string })[] = [];
        /*
            查看前面有沒有註解，目前預設應該要長成...

            ###
            # get digital input
            # @param n number the input to read
            # @returns bool input level
            ###
         */
        const doc = findDoc(nameReg[0], oldLines);
        /* 建立第一列，方法或變數內容 */
        if (/global/.test(step)) {
            items.push(
                {
                    language: 'urscript',
                    value: `global ${nameReg[0]}`
                }
            );
        } else if (/thread/.test(step)) {
            items.push(
                {
                    language: 'urscript',
                    value: `thread  ${nameReg[0]}`
                }
            );
        } else {
            /* 如果有註解，直接利用 */
            if (doc) {
                items.push(
                    {
                        language: 'urscript',
                        value: doc.Label
                    }
                );
            } else {
                /* 提醒是使用者自訂的方法 */
                items.push(new MarkdownString('*user function*'));
                /* 嘗試尋找參數內容 */
                const paramReg = paramPat.exec(step);
                /* 如果有參數，列出來 */
                if (paramReg && paramReg.length > 1) {
                    /* 將參數給拆出來 */
                    const param = paramReg[1].split(',').map(p => p.trim());
                    items.push(new MarkdownString(`${nameReg[0]}(${param.join(', ')})`));
                } else {
                    items.push(new MarkdownString(`${nameReg[0]}()`));
                }
            }
        }
        /* 最後面加入文件說明 */
        if (doc) {
            items.push(doc.Documentation);
        }
        /* 回傳 */
        return new Hover(items);
    }
}

/**
 * 將 RegExpExecArray 轉成對應的 SignatureHelp
 * @param matchResult 欲轉換的 Regex 比對結果
 * @param oldLines 先前已讀過的行暫存
 */
function parseSignature(matchResult: RegExpExecArray | null, oldLines?: string[]): SignatureHelp | undefined {
    /* 如果沒東西，直接離開 */
    if (!matchResult || matchResult.length <= 0) {
        return;
    }
    /* 暫存搜尋的結果 */
    const step = matchResult[0];
    /* 用 Regex 取得方法名稱 */
    const nameReg = namePat.exec(step);
    /* 有成功找到，建立完成項目 */
    if (nameReg) {
        /*
            查看前面有沒有註解，目前預設應該要長成...

            ###
            # get digital input
            # @param n number the input to read
            # @returns bool input level
            ###
         */
        const doc = findDoc(nameReg[0], oldLines);
        /* 如果有找到，進行解析 */
        if (doc) {
            /* 宣告簽章資訊 */
            const sigInfo = new SignatureInformation(doc.Label);
            /* 建立 parameters */
            const sigPara = doc.Parameters.map(
                para => {
                    let paraInfo = new ParameterInformation(para.Label);
                    paraInfo.documentation = para.Documentation;
                    return paraInfo;
                }
            );
            sigInfo.parameters = sigPara;
            /* 建立簽章提示 */
            const sigHelp = new SignatureHelp();
            sigHelp.activeParameter = 0;
            sigHelp.activeSignature = 0;
            sigHelp.signatures = [sigInfo];
            /* 回傳 */
            return sigHelp;
        }
    }
}

/**
 * 搜尋文字內容的所有方法與全域變數
 * @param text 欲搜尋的文字
 * @param keyword 當前使用者輸入的關鍵字
 * @param cmpItems 欲儲存的完成項目集合
 */
export function getCompletionItemsFromText(text: string, keyword: string, cmpItems: CompletionItem[]) {
    /* 建立 Regex Pattern */
    const mthdPat = new RegExp(`\\b(def|thread|global)\\s+${keyword}.*(\\(.*\\):)*`, "gm");
    /* 迴圈尋找符合的方法 */
    let match: RegExpExecArray | null;
    while (match = mthdPat.exec(text)) {
        /* 解析並加入集合 */
        parseCmpItem(match, cmpItems);
    }
}

/**
 * 搜尋檔案內容的所有方法與全域變數
 * @param fileName 欲搜尋的檔案路徑
 * @param keyword 當前使用者輸入的關鍵字
 * @param cmpItems 欲儲存的完成項目集合
 */
export function getCompletionItemsFromFile(fileName: fs.PathLike, keyword: string, cmpItems: CompletionItem[]) {
    /* 建立 Regex Pattern */
    const mthdPat = new RegExp(`\\b(def|thread|global)\\s+${keyword}.*(\\(.*\\):)*`, "gm");
    /* 建立已讀取過的暫存區 */
    const oldLines: string[] = [];
    /* 建立行讀取器 */
    const lineReader = new ReadLinesSync(fileName);
    /* 輪詢每一行 */
    for (const pkg of lineReader) {
        /* 確保有讀到東西 */
        if (pkg.line) {
            /* 轉成字串 */
            const cur = pkg.line.toString().trim();
            /* 利用 Regex 尋找方法或變數名稱 */
            const match = mthdPat.exec(cur);
            /* 解析並加入集合 */
            parseCmpItem(match, cmpItems, oldLines);
            /* 加入讀過的暫存區 */
            if (oldLines.length > 20) {
                oldLines.shift();
            }
            oldLines.push(cur);
        }
    }
}

/**
 * 搜尋 Workspace 內的所有檔案方法與全域變數
 * @param workspace 欲搜尋的 Workspace 路徑
 * @param keyword 當前使用者輸入的關鍵字
 * @param cmpItems 欲儲存的完成項目集合
 */
export function getCompletionItemsFromWorkspace(workspace: WorkspaceFolder, keyword: string, cmpItems: CompletionItem[]) {
    /* 取得資料夾內的所有檔案 */
    const files = fs.readdirSync(workspace.uri.fsPath)
        .filter(file => file.endsWith('.script'))
        .map(file => `${workspace.uri.fsPath}\\${file}`);
    /* 輪詢所有檔案 */
    files.forEach(
        file => getCompletionItemsFromFile(file, keyword, cmpItems)
    );
}

/**
 * 搜尋文字內容的指定關鍵字並轉換成滑鼠提示
 * @param text 欲搜尋的文字
 * @param keyword 當前使用者停留的關鍵字
 */
export function getHoverFromText(text: string, keyword: string): Hover | undefined {
    /* 建立 Regex Pattern */
    const mthdPat = new RegExp(`\\b(def|thread|global)\\s+${keyword}.*(\\(.*\\):)*`, "gm");
    /* 迴圈尋找符合的方法 */
    const match = mthdPat.exec(text);
    /* 回傳 */
    return parseHover(match);
}

/**
 * 搜尋檔案內容的指定關鍵字並轉換成滑鼠提示
 * @param fileName 欲搜尋的檔案路徑
 * @param keyword 當前使用者停留的關鍵字
 */
export function getHoverFromFile(fileName: string, keyword: string): Hover | undefined {
    /* 建立 Regex Pattern */
    const mthdPat = new RegExp(`\\b(def|thread|global)\\s+${keyword}.*(\\(.*\\):)*`, "gm");
    /* 建立已讀取過的暫存區 */
    const oldLines: string[] = [];
    /* 建立讀取器 */
    const lineReader = new ReadLinesSync(fileName);
    /* 輪詢每一行 */
    let hov: Hover | undefined;
    for (const pkg of lineReader) {
        /* 確保有讀到東西 */
        if (pkg.line) {
            /* 轉成字串 */
            const cur = pkg.line.toString().trim();
            /* 嘗試找出方法或變數 */
            const match = mthdPat.exec(cur);
            /* 解析是否有符合的物件 */
            hov = parseHover(match, oldLines);
            /* 成功找到則離開迴圈 */
            if (hov) {
                break;
            }
            /* 加入讀過的暫存區 */
            if (oldLines.length > 20) {
                oldLines.shift();
            }
            oldLines.push(cur);
        }
    }
    /* 回傳 */
    return hov;
}

/**
 * 搜尋 Workspace 內的所有檔案方法與全域變數
 * @param workspace 欲搜尋的 Workspace 路徑
 * @param keyword 當前使用者輸入的關鍵字
 * @param explored 已經探索過(要跳過)的檔案名稱
 */
export function getHoverFromWorkspace(workspace: WorkspaceFolder, keyword: string, explored: string): Hover | undefined {
    /* 取得資料夾內的所有檔案 */
    const files = fs.readdirSync(workspace.uri.fsPath)
        .filter(file => file.endsWith('.script') && (file !== explored.split(/.*[\/|\\]/)[1]))
        .map(file => `${workspace.uri.fsPath}\\${file}`);
    /* 輪詢所有檔案 */
    let hov: Hover | undefined;
    for (const file of files) {
        /* 搜尋檔案中是否有指定的關鍵字並取得其資訊 */
        hov = getHoverFromFile(file, keyword);
        /* 如果有東西則離開迴圈 */
        if (hov) {
            break;
        }
    }
    /* 回傳 */
    return hov;
}

/**
 * 搜尋檔案內容的指定關鍵字並轉換成定義位置
 * @param fileName 欲解析的檔案路徑
 * @param keyword 欲搜尋的關鍵字
 */
export function getLocationFromFile(fileName: fs.PathLike, keyword: string): Location[] {
    /* 建立 Regex Pattern */
    const mthdPat = new RegExp(`\\b(def|thread|global)\\s+${keyword}.*(\\(.*\\):)*`, "gm");
    const namePat = /\b(?!def|thread|global)\w+/gm;
    /* 宣告回傳變數 */
    let locColl: Location[] = [];
    /* 建立行讀取器 */
    const lineReader = new ReadLinesSync(fileName);
    /* 輪詢每一行，直至找到關鍵字 */
    for (const ret of lineReader) {
        /* 確保有讀到資料 */
        if (ret.line) {
            /* 迴圈尋找符合的方法 */
            const match = mthdPat.exec(ret.line.toString());
            if (match) {
                /* 用 Regex 取得方法名稱 */
                const nameReg = namePat.exec(match[0]);
                /* 有成功找到，建立完成項目 */
                if (nameReg) {
                    const loc = new Location(
                        Uri.file(fileName.toString()),
                        new Position(
                            ret.lineNo,
                            nameReg.index
                        )
                    );
                    locColl.push(loc);
                }
            }
        }
    }
    return locColl;
}

/**
 * 搜尋 Workspace 內的所有檔案，藉以找出定義位置
 * @param workspace 欲搜尋的 Workspace 路徑
 * @param keyword 當前使用者輸入的關鍵字
 * @param explored 已經探索過(要跳過)的檔案名稱
 */
export function getLocationFromWorkspace(workspace: WorkspaceFolder, keyword: string, explored: string): Location[] {
    /* 取得資料夾內的所有檔案 */
    const files = fs.readdirSync(workspace.uri.fsPath)
        .filter(file => file.endsWith('.script') && (file !== explored.split(/.*[\/|\\]/)[1]))
        .map(file => `${workspace.uri.fsPath}\\${file}`);
    /* 初始化變數 */
    let locColl: Location[] = [];
    /* 輪詢所有檔案 */
    for (const file of files) {
        /* 讀取 Location */
        const loc = getLocationFromFile(file, keyword);
        if (loc) {
            loc.forEach(l => locColl.push(l));
        }
    }
    /* 回傳 */
    return locColl;
}

/**
 * 搜尋檔案內容的指定關鍵字並轉換成簽章
 * @param fileName 欲搜尋的檔案路徑
 * @param keyword 當前使用者停留的關鍵字
 */
export function getSignatureFromFile(fileName: string, keyword: string): SignatureHelp | undefined {
    /* 建立 Regex Pattern */
    const mthdPat = new RegExp(`\\b(def)\\s+${keyword}.*(\\(.*\\):)*`, "gm");
    /* 建立已讀取過的暫存區 */
    const oldLines: string[] = [];
    /* 建立讀取器 */
    const lineReader = new ReadLinesSync(fileName);
    /* 輪詢每一行 */
    let sigHelp: SignatureHelp | undefined;
    for (const pkg of lineReader) {
        /* 確保有讀到東西 */
        if (pkg.line) {
            /* 轉成字串 */
            const cur = pkg.line.toString().trim();
            /* 嘗試找出方法或變數 */
            const match = mthdPat.exec(cur);
            /* 解析是否有符合的物件 */
            sigHelp = parseSignature(match, oldLines);
            /* 成功找到則離開迴圈 */
            if (sigHelp) {
                break;
            }
            /* 加入讀過的暫存區 */
            if (oldLines.length > 20) {
                oldLines.shift();
            }
            oldLines.push(cur);
        }
    }
    /* 回傳 */
    return sigHelp;
}

/**
 * 搜尋 Workspace 內的所有檔案，並找出符合的簽章
 * @param workspace 欲搜尋的 Workspace 路徑
 * @param keyword 當前使用者輸入的關鍵字
 * @param explored 已經探索過(要跳過)的檔案名稱
 */
export function getSignatureFromWorkspace(workspace: WorkspaceFolder, keyword: string, explored: string): SignatureHelp | undefined {
    /* 取得資料夾內的所有檔案 */
    const files = fs.readdirSync(workspace.uri.fsPath)
        .filter(file => file.endsWith('.script') && (file !== explored.split(/.*[\/|\\]/)[1]))
        .map(file => `${workspace.uri.fsPath}\\${file}`);
    /* 輪詢所有檔案 */
    let sigHelp: SignatureHelp | undefined;
    for (const file of files) {
        /* 搜尋檔案中是否有指定的關鍵字並取得其資訊 */
        sigHelp = getSignatureFromFile(file, keyword);
        /* 如果有東西則離開迴圈 */
        if (sigHelp) {
            break;
        }
    }
    /* 回傳 */
    return sigHelp;
}