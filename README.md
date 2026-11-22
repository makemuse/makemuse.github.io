# MAKE MUSE — 厳選メイクピンのキュレーションサイト

Pinterestから「メイク画像だけ」を厳選し、タグで検索・絞り込みできる静的サイトです。
サーバー・データベース・AIは不要。GitHub Pages でそのまま公開できます。

## フォルダ構成

```
index.html          … ページ本体（広告枠の位置もここ）
css/style.css       … デザイン（色は先頭の :root で変更可）
js/app.js           … 検索・タグ絞り込み・ページ送り・埋め込み処理
data/pins.json      … ピンのデータ（ここを編集して追加）
data/synonyms.json  … 言い換え辞書（表記ゆれ対策）
.nojekyll           … GitHub Pages で余計な変換をさせないための空ファイル
```

## ピンの追加方法（data/pins.json）

```json
{
  "url": "https://www.pinterest.com/pin/1234567890123456789/",
  "tags": ["中顔面短縮", "一重"],
  "comment": "監修コメント",
  "cosme": "使用コスメ（任意）",
  "cosmeUrl": "アフィリエイトURL（任意。入れると「このコスメをチェック」ボタンが出る）"
}
```

- `url` は Pinterest でピンを開いたときのアドレス（`/pin/数字/` の形）。`pin.it/xxxx` の短縮URLはブラウザで開いて展開後のURLを使ってください。
- 配列の末尾以外は `}` の後ろに `,` が必要です。カンマ抜け・付けすぎがあるとページが表示されません（[JSONLint](https://jsonlint.com/) で確認できます）。
- **サンプルの10件はダミーURLなので画像は出ません**（代替表示になります）。実際のピンURLに差し替えてください。

## 言い換え辞書（data/synonyms.json）

```json
"一重": ["奥二重", "ひとえ", "一重まぶた"]
```

キーと配列の語は**同じグループ**として扱われます（双方向）。
例：「奥二重」で検索 → `#一重` `#奥二重` のピンが両方ヒット。「面長」→ `#中顔面短縮` も出る。

- ひらがな/カタカナ、全角/半角、大文字/小文字、先頭の `#` は自動で吸収されます。
- スペース区切りで複数語を入れると AND 検索になります（例：`一重 涙袋`）。
- 使用コスメ名でも検索できます（例：`キャンメイク`）。

## ローカルで確認する

`index.html` をダブルクリックで開くと、ブラウザの制限で JSON が読めません。フォルダで次を実行し、http://localhost:8000 を開きます。

```
python -m http.server 8000
```

## GitHub Pages で公開する手順

1. GitHub にログインし、右上「＋」→ **New repository**。名前（例：`make-muse`）を入れ、**Public** を選んで作成。
2. 作成したリポジトリの画面で **Add file → Upload files**。このフォルダの中身（`index.html` `css` `js` `data` `.nojekyll` など）をドラッグ&ドロップして **Commit changes**。
   - `.nojekyll` は隠しファイルなので、見えない場合はなくても動きます。
3. リポジトリの **Settings → Pages** を開く。
4. **Build and deployment** の Source を **Deploy from a branch**、Branch を **main** / **/(root)** にして **Save**。
5. 1〜2分待つと `https://ユーザー名.github.io/make-muse/` で公開されます（Pages 画面上部にURLが表示されます）。

更新するときは、`data/pins.json` を GitHub 上で開いて鉛筆アイコンで編集 → Commit するだけで反映されます（反映まで1分ほど。ブラウザのキャッシュに注意）。

独自ドメインを使う場合は Settings → Pages → **Custom domain** に入力し、DNS 側で CNAME を設定します。

## 広告・アフィリエイトの貼り場所

| 場所 | ファイル | 目印 |
|---|---|---|
| ページ全体のAdSenseコード（審査・自動広告） | `index.html` の `<head>` | コメント `AdSense を使う場合は…` |
| 上部バナー（タグの下・結果の上） | `index.html` | `<aside class="ad-slot ad-slot--top">` |
| 下部バナー（ページ送りの下） | `index.html` | `<aside class="ad-slot ad-slot--bottom">` |
| インフィード（6件ごとにカード間） | `js/app.js` | `function adHTML` |
| コスメのアフィリエイトボタン | `data/pins.json` | 各ピンの `cosmeUrl` |
| カード単位の自由枠 | `js/app.js` | `function cardHTML` 内のコメント |

- 広告枠は、中身が空だと自動で非表示になります。
- 開発中は点線の「AD SPACE」が見えます。公開時は `js/app.js` 先頭の `showAdPlaceholders` を `false` に。
- AdSense を `<aside>` 内に入れるときの例：

```html
<aside class="ad-slot ad-slot--top" data-ad="top" aria-label="広告">
  <ins class="adsbygoogle" style="display:block"
       data-ad-client="ca-pub-XXXXXXXXXXXXXXXX" data-ad-slot="1234567890"
       data-ad-format="auto" data-full-width-responsive="true"></ins>
  <script>(adsbygoogle = window.adsbygoogle || []).push({});</script>
</aside>
```

- インフィード枠は JS で後から差し込まれるため、AdSense を使う場合は `adHTML` に `<ins>` を入れ、`render()` の最後で `(adsbygoogle = window.adsbygoogle || []).push({})` を枠の数だけ呼んでください。
- アフィリエイトリンクを使う場合は、ステマ規制に合わせて「PR」表記（ボタン横に自動表示）とフッターの表記を残してください。

## 設定（js/app.js 先頭の CONFIG）

| 項目 | 意味 |
|---|---|
| `perPage` | 1ページの件数（初期値12） |
| `inFeedAdEvery` | 何件ごとにインフィード広告枠を入れるか（0で無効） |
| `showAdPlaceholders` | 広告枠の点線表示 |
| `pinWidth` | 埋め込みサイズ `small` / `medium` / `large` |

## 補足

- 検索条件はURLに残るので（例：`?tag=一重&tag=涙袋`）、そのままSNSで共有できます。
- 削除・非公開になったピンは、7秒後に「Pinterestで見る」付きの代替表示に切り替わります。
- 画像はPinterest公式の埋め込みで表示しているため、画像を自分でダウンロード・再アップロードする必要はありません（その方が著作権的にも安全です）。
