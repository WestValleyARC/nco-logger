/* hamlive-oss — MIT License. See LICENSE. */

'use strict';

import { HttpClient, FormState } from '#@client/lib/old__clientUtils.js';

const userProfileFormState = new FormState('userprofile', 'new');
const userProfileApi = new HttpClient('userprofile', '/api/data/userprofiles');
const queryString = window.location.search;
const urlParams = new URLSearchParams(queryString);
const consent_modal = new bootstrap.Modal(document.getElementById('consent_modal'));
const appearanceManager = window.ncoLoggerAppearance;
const appearanceControls = document.querySelectorAll('input[name="appearance"]');
const appearanceCurrent = document.getElementById('appearance-current');

function syncAppearanceControl() {
    if (!appearanceManager) return;

    const appearance = appearanceManager.getAppearance();
    appearanceControls.forEach(control => {
        control.checked = control.value === appearance;
    });

    if (appearanceCurrent) {
        const resolvedTheme = appearanceManager.getTheme();
        appearanceCurrent.textContent =
            appearance === 'system'
                ? `Following this device (currently ${resolvedTheme}).`
                : `Using ${resolvedTheme} appearance.`;
    }
}

appearanceControls.forEach(control => {
    control.addEventListener('change', () => {
        if (control.checked && appearanceManager) appearanceManager.setAppearance(control.value);
    });
});
window.addEventListener('ncoLogger:appearancechange', syncAppearanceControl);
syncAppearanceControl();

function getConsent(done) {
    consent_modal.show();

    document.getElementById('consent_accept').addEventListener('click', () => {
        consent_modal.hide();
        done(true);
    });

    document.getElementById('consent_decline').addEventListener('click', () => {
        consent_modal.hide();
        done(false);
    });
}

userProfileApi.index().then(userProfile => {
    if (typeof userProfile.data.location === 'undefined') {
        navigator.geolocation.getCurrentPosition(
            pos => {
                const { latitude, longitude } = pos.coords;

                axios
                    .get(`/api/util/resolvelocation?lat=${latitude}&lon=${longitude}`)
                    .then(result => {
                        document.getElementById('input_location').value = result.data.location;
                    })
                    .catch(error => {
                        if (error.response.data.errorMessage) {
                            console.error(error.response.data.errorMessage);
                        } else {
                            console.error('Error', error.message);
                        }
                    });
            },
            err => {
                console.error(`geolocation error: (${err.code}): ${err.message}`);
            },
            {
                enableHighAccuracy: true,
                timeout: 5000,
                maximumAge: 0
            }
        );
    }

    if (userProfile.data.policyConsent) {
        if (userProfile.data.newAccount) {
            userProfileFormState.mode = 'new';
            userProfileFormState.mesg('info', 'Call Sign Required for Net Attendance');
            document.getElementById('input_display_name').value = userProfile.data.displayName;
            document.getElementById('input_id').value = userProfile.data._id;
        } else {
            userProfileFormState.mode = 'edit';
            userProfileFormState.mesg('info', 'Edit Existing Profile');

            if (userProfile.data.flaggedForDeletion) {
                userProfileFormState.mesg('error', 'Account Flagged For Deletion');
            }

            document.getElementById('input_display_name').value = userProfile.data.displayName;
            document.getElementById('input_callsign').value = userProfile.data.callSign;
            document.getElementById('input_location').value = userProfile.data.location;
            document.getElementById('input_id').value = userProfile.data._id;
        }

        if (urlParams.has('cswarn')) {
            userProfileFormState.mesg('error', 'Call Sign Required for Net Attendance');
        }
    } else {
        getConsent(consent => {
            if (consent) {
                userProfileFormState.mode = 'new';
                userProfileFormState.mesg('info', 'Call Sign Required for Net Attendance');
                document.getElementById('input_display_name').value = userProfile.data.displayName;
                document.getElementById('input_id').value = userProfile.data._id;

                userProfileApi
                    .update(
                        {
                            policyConsent: true
                        },
                        userProfile.data._id
                    )
                    .then(req => {
                        console.debug('PATCH-ed Policy Consent: true');
                        userProfileFormState.mesg('info', 'policy consent saved');

                        const locationElem = document.getElementById('input_location');

                        if (locationElem.value.length == 0) {
                            navigator.geolocation.getCurrentPosition(
                                pos => {
                                    const { latitude, longitude } = pos.coords;

                                    axios
                                        .get(`/api/util/resolvelocation?lat=${latitude}&lon=${longitude}`)
                                        .then(result => {
                                            locationElem.value = result.data.location;
                                        })
                                        .catch(error => {
                                            if (error.response.data.errorMessage) {
                                                console.error(error.response.data.errorMessage);
                                            } else {
                                                console.error('Error', error.message);
                                            }
                                        });
                                },
                                err => {
                                    console.error(`geolocation error: (${err.code}): ${err.message}`);
                                },
                                {
                                    enableHighAccuracy: true,
                                    timeout: 5000,
                                    maximumAge: 0
                                }
                            );
                        }
                    })
                    .catch(error => {
                        if (error.response.data.errorMessage) {
                            userProfileFormState.mesg('error', error.response.data.errorMessage);
                            console.error(error.response.data.errorMessage);
                        } else {
                            userProfileFormState.mesg('error', 'error');
                        }

                        console.error('Error', error.message);
                    });
            } else {
                userProfileApi
                    .delete(userProfile.data._id)
                    .then(req => {
                        console.debug('deleted');
                        userProfileFormState.mesg('error', 'deleted');

                        setTimeout(() => {
                            window.location.replace('/logout');
                        }, 3500);
                    })
                    .catch(error => {
                        if (error.response.data.errorMessage) {
                            userProfileFormState.mesg('error', error.response.data.errorMessage);
                            console.error(error.response.data.errorMessage);
                        } else {
                            userProfileFormState.mesg('error', 'error');
                        }

                        console.error('Error', error.message);
                    });
            }
        });
    }
});

document.getElementById('userprofile_form').addEventListener('submit', e => {
    e.preventDefault();

    const formDataToSend = new FormData(document.getElementById('userprofile_form'));

    const id = document.getElementById('input_id').value;

    const dataPayload = {
        displayName: formDataToSend.get('display_name'),
        callSign: formDataToSend.get('callsign'),
        location: formDataToSend.get('location'),
        newAccount: false
    };

    console.log('Data Payload Sending:', dataPayload);

    userProfileApi
        .update(dataPayload, id)
        .then(req => {
            console.debug('Update: ', req);
            userProfileFormState.mesg('info', 'updated');
            setTimeout(() => {
                window.location.replace('/views/dashboard');
            }, 3000);
        })
        .catch(error => {
            if (error.response.data.errorMessage) {
                userProfileFormState.mesg('error', error.response.data.errorMessage);
                console.error(error.response.data.errorMessage);
            } else {
                userProfileFormState.mesg('error', 'error');
            }

            console.error('Error', error.message);

            setTimeout(() => {
                userProfileFormState.mode = 'edit';
                userProfileFormState.mesg('info', 'Edit Existing Profile');
            }, 15000);
        });
});
