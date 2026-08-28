/* hamlive-oss — MIT License. See LICENSE. */

'use strict';

import { HttpClient } from '#@client/lib/old__clientUtils.js';

(async function () {
    const magicHttpClient = new HttpClient('magicLogin', `/auth/magiclogin`);
    const form = document.getElementById('magic-auth');
    const inputElem = document.getElementById('input_magic-auth-email_addr');
    const submitButton = document.getElementById('magic-auth-submit');
    const statusElem = document.getElementById('magic-auth-status');
    const devLinkContainer = document.getElementById('dev-magic-link');

    if (!form || !inputElem || !submitButton || !statusElem) return;

    const setStatus = (message, style = 'muted') => {
        statusElem.textContent = message;
        statusElem.setAttribute('class', `small mt-2 mb-0 text-${style}`);
    };

    form.addEventListener('submit', async e => {
        e.preventDefault();
        if (!inputElem.checkValidity()) {
            inputElem.reportValidity();
            return;
        }

        inputElem.disabled = true;
        submitButton.disabled = true;
        submitButton.textContent = 'Sending…';
        setStatus('Requesting your sign-in link…');
        if (devLinkContainer) devLinkContainer.replaceChildren();

        try {
            const { data } = await magicHttpClient.create({
                destination: inputElem.value
            });

            if (!data.success) throw new Error('Email delivery was not accepted');

            // Local test drive: when email delivery is off, the server returns the
            // sign-in link directly so the user doesn't need to read server logs.
            if (data.devMagicLink && devLinkContainer) {
                const link = document.createElement('a');
                link.href = data.devMagicLink;
                link.textContent = 'Click here to finish signing in →';
                link.setAttribute('class', 'btn btn-sm btn-success w-100');
                devLinkContainer.appendChild(link);
                setStatus('Local sign-in link created.', 'success');
            } else {
                setStatus('Email accepted for delivery. Check your inbox and spam folder.', 'success');
            }

            submitButton.textContent = 'Send another sign-in link';
        } catch (err) {
            const serverMessage = err.response?.data?.error;
            setStatus(
                typeof serverMessage === 'string'
                    ? serverMessage
                    : 'The sign-in email could not be sent. Please try again or use Google sign-in.',
                'danger'
            );
            submitButton.textContent = 'Try sending again';
            console.warn('Magic-link delivery request failed');
        } finally {
            inputElem.disabled = false;
            submitButton.disabled = false;
            if (document.activeElement !== inputElem) {
                submitButton.focus();
            }
        }
    });
})();
