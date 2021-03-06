//用於 vscode 的名稱解析
import {
    CancellationToken,
    ParameterInformation,
    Position,
    SignatureHelp,
    SignatureHelpContext,
    SignatureHelpProvider,
    SignatureHelpProviderMetadata,
    SignatureInformation,
    TextDocument,
    workspace
} from 'vscode';
//用於載入外部的方法集合
import { ScriptMethod } from '../scriptmethod';
//用於判斷物件是否為空
import { isNullOrUndefined } from 'util';
//用於解析程式碼以提供相關物件的解析
import { getSignatureFromWorkspace, getSignatureFromDocument } from '../codeParser';

/**
 * 儲存 ScriptMethod 對應的 Hover 項目
 */
class ScriptSignature {

    /** 方法名稱 */
    Name: string;
    /** 方法對應的提示項目 */
    Item: SignatureHelp;

    /**
     * 建構方法對應項目
     * @param mthd 欲處理的 Script 方法
     */
    constructor(mthd: ScriptMethod) {
        /* 宣告簽章資訊 */
        const sigInfo = new SignatureInformation(mthd.Label);
        /* 建立 parameters */
        const sigPara = mthd.Parameters.map(
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
        /* 賦值 */
        this.Item = sigHelp;
        this.Name = mthd.Name;
    }
}

/**
 * 適用於 URScript 的簽章提示供應器
 */
export class URScriptSignatureHelpProvider implements SignatureHelpProvider {

    /** 儲存已解析完的官方 API 簽章項目 */
    private scriptSignatures: ScriptSignature[];

    /**
     * 建構簽章提示供應器
     * @param funcs 已載入的 URScript 方法集合
     */
    public constructor(funcs: ScriptMethod[]) {
        this.scriptSignatures = funcs.map(mthd => new ScriptSignature(mthd));
    }

    /**
     * 取得滑鼠輸入中的簽章提示
     * @param document vscode 當前的文字編輯器
     * @param position 當前文字插入點的座標
     * @param token 指出是否取消動作的物件
     * @param context 欲處理的上下文
     */
    public async provideSignatureHelp(document: TextDocument, position: Position, token: CancellationToken, context: SignatureHelpContext): Promise<SignatureHelp | undefined> {
        try {
            /* 取得當前的行號 */
            const line = document.lineAt(position);
            /* 查詢是否有 '(' ，以利尋找方法名稱。 小括號 = parentheses，常用縮寫 par */
            const parLeft = line.text.indexOf('(');
            /* 查詢 '(' 後方是否有 ')' ，以利判斷當前是否已結束括號 */
            const parRight = line.text.indexOf(')', parLeft);
            /* 如果範圍不正確，直接離開 */
            if ((position.character < parLeft) || (parRight < position.character)) {
                return undefined;
            }
            /* 如果是重新觸發的，將 parameter index 往後移 */
            if (context.isRetrigger && !isNullOrUndefined(context.activeSignatureHelp)) {
                /* 尋找當前已輸入多少個 ',' */
                //先取得括號內的參數字串，為 '(' 到當前文字插入點之間的字串
                const paraStr = line.text.substr(parLeft + 1, position.character - parLeft - 1);
                //利用 ',' 分割
                const paraAry = paraStr.split(',');
                /* 更改 parameter index，為輸入幾個 ',' 的數量減一，因 parameter index 是從零開始 */
                context.activeSignatureHelp.activeParameter = paraAry.length - 1;
                /* 回傳既有的 SignatureHelp */
                return context.activeSignatureHelp;
            } else {
                /* 並非重新觸發，尋找方法名稱並準備建立 SignatureHelp */
                /* 取得 '(' 左側是否有字詞(前後為符號或空白則認定字詞)，如果有則取得其字詞範圍，照理說應為方法名稱 */
                const wordRange = document.getWordRangeAtPosition(
                    new Position(line.lineNumber, parLeft - 1)
                );
                /* 取得 '(' 左側的字詞 */
                const word = document.getText(wordRange);
                /* 尋找是否有符合的方法 */
                const matched = this.scriptSignatures.find(sig => sig.Name === word);
                /* 有找到東西，重設起始參數 */
                if (matched) {
                    /* 從 0 開始顯示 */
                    matched.Item.activeParameter = 0;
                    matched.Item.activeSignature = 0;
                    /* 回傳 */
                    return matched.Item;
                } else {
                    /* 如果沒有找到，找一下當前的檔案是否有符合的項目 */
                    let sigHelp = getSignatureFromDocument(document, word);
                    /* 如果沒有，則往 Workspace 開找 */
                    if (!sigHelp && workspace.workspaceFolders) {
                        /* 輪詢各個資料夾 */
                        for (const fold of workspace.workspaceFolders) {
                            /* 嘗試找出 Hover */
                            sigHelp = getSignatureFromWorkspace(fold, word, document.fileName);
                            /* 如果有則離開並回傳 */
                            if (sigHelp) {
                                break;
                            }
                        }
                    }
                    /* 回傳 */
                    return sigHelp;
                }
            }
        } catch (error) {
            return undefined;
        }
    }
}

/**
 * 適用於 URScript 的簽章提示觸發設定
 */
export class URScriptSignatureHelpProviderMetadata implements SignatureHelpProviderMetadata {

    /** 於文字編輯器觸發簽章提示的字元集合 */
    triggerCharacters: string[];
    /** 重新觸發、更改參數索引的字元集合 */
    retriggerCharacters: string[];

    /**
     * 建構簽章提示觸發設定
     */
    constructor() {
        this.triggerCharacters = ['('];
        this.retriggerCharacters = [','];
    }
}