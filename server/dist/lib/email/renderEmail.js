/* hamlive-oss — MIT License. See LICENSE. */

const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const { absoluteAppUrl, appEmailUrls } = require('./urls');

const shell = fs.readFileSync(path.join(__dirname, '../../views/email/shell.ejs'), 'utf8');
const COPYRIGHT = '© 2026 West Valley Amateur Radio Club (WVARC). All rights reserved.';

const requiredText = (value, label) => {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
    return value.trim();
};

const renderBlocks = blocks => {
    const html = [];
    const text = [];
    for (const block of blocks || []) {
        if (block.type === 'paragraph') {
            const value = requiredText(block.text, 'Paragraph text');
            html.push(`<p style="Margin:0 0 18px;color:#253247;font-size:16px;line-height:1.6;">${ejs.escapeXML(value)}</p>`);
            text.push(value);
        } else if (block.type === 'message') {
            const label = requiredText(block.label, 'Message label');
            const value = requiredText(block.text, 'Message text');
            html.push(`<p style="Margin:0 0 8px;color:#526174;font-size:14px;line-height:1.5;"><strong>${ejs.escapeXML(label)}</strong></p>` +
                `<p style="Margin:0 0 18px;color:#253247;font-size:16px;line-height:1.6;">${ejs.escapeXML(value).replace(/\r?\n/g, '<br>')}</p>`);
            text.push(`${label}:\n${value}`);
        } else if (block.type === 'details') {
            const rows = (block.items || []).map(item => ({
                label: requiredText(item.label, 'Detail label'),
                value: requiredText(item.value, 'Detail value')
            }));
            if (!rows.length) throw new Error('Details must contain at least one item');
            html.push('<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="Margin:0 0 18px;border-collapse:collapse;">' +
                rows.map(row => `<tr><td style="padding:7px 10px;border-bottom:1px solid #dce5ea;color:#526174;font-size:14px;vertical-align:top;"><strong>${ejs.escapeXML(row.label)}</strong></td><td style="padding:7px 10px;border-bottom:1px solid #dce5ea;color:#253247;font-size:14px;vertical-align:top;">${ejs.escapeXML(row.value)}</td></tr>`).join('') +
                '</table>');
            text.push(rows.map(row => `${row.label}: ${row.value}`).join('\n'));
        } else if (block.type === 'table') {
            const caption = requiredText(block.caption, 'Table caption');
            const columns = (block.columns || []).map(column => requiredText(column, 'Table column'));
            const rows = (block.rows || []).map(row => ({
                values: (row.values || []).map(value => String(value ?? '')),
                highlight: Boolean(row.highlight)
            }));
            if (!columns.length || rows.some(row => row.values.length !== columns.length)) {
                throw new Error('Email table rows must match its columns');
            }
            html.push(`<table role="table" aria-label="${ejs.escapeXML(caption)}" width="100%" cellspacing="0" cellpadding="0" border="0" style="Margin:0 0 18px;width:100%;border-collapse:collapse;border:1px solid #cdd9df;">` +
                `<caption style="padding:0 0 10px;color:#071827;font-size:16px;font-weight:700;text-align:left;">${ejs.escapeXML(caption)}</caption>` +
                `<thead><tr>${columns.map(column => `<th scope="col" bgcolor="#dceff3" style="padding:8px 6px;border-bottom:1px solid #aebfc7;color:#071827;font-size:12px;line-height:1.35;text-align:left;">${ejs.escapeXML(column)}</th>`).join('')}</tr></thead>` +
                `<tbody>${rows.map(row => `<tr${row.highlight ? ' bgcolor="#f3eee7"' : ''}>${row.values.map(value => `<td style="padding:8px 6px;border-bottom:1px solid #dce5ea;color:#253247;font-size:13px;line-height:1.4;vertical-align:top;word-break:break-word;">${ejs.escapeXML(value)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
            text.push(`${caption}:\n${rows.map(row => row.values.join(' | ')).join('\n') || '[No entries]'}`);
        } else {
            throw new Error(`Unsupported email content block: ${block?.type || '(missing)'}`);
        }
    }
    return { html: html.join(''), text: text.join('\n\n') };
};

const renderEmail = ({ baseUrl, subject, preheader, heading, blocks = [], cta, secondaryLinks = [], automatedNotice }) => {
    const safeSubject = requiredText(subject, 'Email subject');
    const safeHeading = requiredText(heading, 'Email heading');
    const safePreheader = preheader ? requiredText(preheader, 'Email preheader') : safeSubject;
    const content = renderBlocks(blocks);
    const urls = appEmailUrls(baseUrl);
    const logoUrl = absoluteAppUrl('/img/NCO_Logger_Logo_compact.png', baseUrl);
    const action = cta ? {
        label: requiredText(cta.label, 'CTA label'),
        url: absoluteAppUrl(requiredText(cta.path, 'CTA path'), baseUrl)
    } : null;
    const links = secondaryLinks.map(link => ({
        label: requiredText(link.label, 'Secondary link label'),
        url: absoluteAppUrl(requiredText(link.path, 'Secondary link path'), baseUrl)
    }));
    const notice = automatedNotice ? requiredText(automatedNotice, 'Automated notice') : '';
    const html = ejs.render(shell, {
        subject: safeSubject,
        preheader: safePreheader,
        heading: safeHeading,
        contentHtml: content.html,
        cta: action,
        secondaryLinks: links,
        automatedNotice: notice,
        contactUrl: urls.contact,
        logoUrl,
        copyright: COPYRIGHT
    });
    const text = [
        safeHeading,
        content.text,
        action && `${action.label}: ${action.url}`,
        ...links.map(link => `${link.label}: ${link.url}`),
        notice,
        `Contact NCO Logger: ${urls.contact}`,
        'NCO Logger is operated by West Valley Amateur Radio Club (WVARC).',
        COPYRIGHT
    ].filter(Boolean).join('\n\n');
    return { subject: safeSubject, html, text };
};

module.exports = { COPYRIGHT, renderEmail };
