const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" fill="#E48A7A" aria-hidden="true"><path d="M262 46h60v60h-60zM334 46h60v60h-60zM406 46h60v60h-60zM478 46h60v60h-60zM190 118h60v60h-60zM262 118h60v60h-60zM334 118h60v60h-60zM406 118h60v60h-60zM478 118h60v60h-60zM550 118h60v60h-60zM118 190h60v60h-60zM190 190h60v60h-60zM550 190h60v60h-60zM622 190h60v60h-60zM118 262h60v60h-60zM190 262h60v60h-60zM118 334h60v60h-60zM190 334h60v60h-60zM262 334h60v60h-60zM334 334h60v60h-60zM406 334h60v60h-60zM478 334h60v60h-60zM550 334h60v60h-60zM622 334h60v60h-60zM118 406h60v60h-60zM190 406h60v60h-60zM262 406h60v60h-60zM334 406h60v60h-60zM406 406h60v60h-60zM478 406h60v60h-60zM550 406h60v60h-60zM622 406h60v60h-60zM550 478h60v60h-60zM622 478h60v60h-60zM118 550h60v60h-60zM190 550h60v60h-60zM550 550h60v60h-60zM622 550h60v60h-60zM190 622h60v60h-60zM262 622h60v60h-60zM334 622h60v60h-60zM406 622h60v60h-60zM478 622h60v60h-60zM550 622h60v60h-60zM262 694h60v60h-60zM334 694h60v60h-60zM406 694h60v60h-60zM478 694h60v60h-60z"/></svg>`;

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function renderPage(options: { title: string; heading: string; message: string; details?: string }): string {
	const title = escapeHtml(options.title);
	const heading = escapeHtml(options.heading);
	const message = escapeHtml(options.message);
	const details = options.details ? escapeHtml(options.details) : undefined;

	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    :root {
      --text: #fafafa;
      --text-dim: #a1a1aa;
      --page-bg: #09090b;
      --font-sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    }
    * { box-sizing: border-box; }
    html { color-scheme: dark; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: var(--page-bg);
      color: var(--text);
      font-family: var(--font-sans);
      text-align: center;
    }
    main {
      width: 100%;
      max-width: 560px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
    .logo {
      width: 72px;
      height: 72px;
      display: block;
      margin-bottom: 24px;
    }
    h1 {
      margin: 0 0 10px;
      font-size: 28px;
      line-height: 1.15;
      font-weight: 650;
      color: var(--text);
    }
    p {
      margin: 0;
      line-height: 1.7;
      color: var(--text-dim);
      font-size: 15px;
    }
    .details {
      margin-top: 16px;
      font-family: var(--font-mono);
      font-size: 13px;
      color: var(--text-dim);
      white-space: pre-wrap;
      word-break: break-word;
    }
  </style>
</head>
<body>
  <main>
    <div class="logo">${LOGO_SVG}</div>
    <h1>${heading}</h1>
    <p>${message}</p>
    ${details ? `<div class="details">${details}</div>` : ""}
  </main>
</body>
</html>`;
}

export function oauthSuccessHtml(message: string): string {
	return renderPage({
		title: "Authentication successful",
		heading: "Authentication successful",
		message,
	});
}

export function oauthErrorHtml(message: string, details?: string): string {
	return renderPage({
		title: "Authentication failed",
		heading: "Authentication failed",
		message,
		details,
	});
}
