/* hamlive-oss — MIT License. See LICENSE. */

import { EndPointClient, getIconSvg } from '#@client/lib/clientUtils.js';
import { createLogger } from '#@client/lib/logger.js';
import type { SystemNotification } from '#@client/types/commonTypes.js';
import { isSystemNotificationResponse } from '#@client/types/commonTypesupport.js';

const logger = createLogger('lib/systemNotifications.ts');

export class SystemNotificationManager {
    private static readonly DISMISSED_KEY = 'dismissedNotifications';
    private apiClient: EndPointClient;
    private modalElement: HTMLElement | null = null;

    constructor() {
        this.apiClient = new EndPointClient('/api/util/notifications');
    }

    /**
     * Check for pending notifications and display the first one
     */
    async checkAndDisplayNotifications(): Promise<void> {
        try {
            const response = await this.apiClient.id('pending').show();

            // Validate response format
            if (!isSystemNotificationResponse(response)) {
                if (response.errorMessage) {
                    logger.debug('Error fetching notifications:', response.errorMessage);
                } else {
                    logger.error('Invalid notification response format');
                }
                return;
            }

            const { notifications, count } = response.message;

            if (count === 0 || notifications.length === 0) {
                logger.debug('No pending notifications');
                return;
            }

            // Show the most recent notification
            const firstNotification = notifications[0];
            if (!firstNotification) {
                logger.error('First notification is undefined despite count > 0');
                return;
            }

            // Double-check localStorage as backup
            if (this.isAlreadyDismissedLocally(firstNotification.notificationId)) {
                logger.debug(`Notification ${firstNotification.notificationId} already dismissed locally`);
                return;
            }

            this.displayNotification(firstNotification);
        } catch (error) {
            logger.error('Failed to fetch notifications:', error);
        }
    }

    /**
     * Display a notification in a Bootstrap modal
     */
    private displayNotification(notification: SystemNotification): void {
        // Remove any existing notification modal
        this.removeModal();

        // Create modal HTML
        const modal = this.createModalHTML(notification);
        document.body.appendChild(modal);
        this.modalElement = modal;

        // Get Bootstrap from window
        const Bootstrap = (window as unknown as { bootstrap: { Modal: BootstrapModalConstructor } }).bootstrap;

        // Initialize Bootstrap modal
        const bsModal = new Bootstrap.Modal(modal, {
            backdrop: 'static',
            keyboard: false
        });

        // Setup dismiss handlers (both "Got it" button and X close button)
        const dismissBtns = modal.querySelectorAll('[data-dismiss-notification]');
        dismissBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                void this.dismissNotification(notification.notificationId).then(() => {
                    bsModal.hide();
                    setTimeout(() => this.removeModal(), 300); // Wait for animation
                });
            });
        });

        // Show modal
        bsModal.show();
    }

    /**
     * Create modal HTML structure
     */
    private createModalHTML(notification: SystemNotification): HTMLElement {
        const severityIcon = this.getSeverityIcon(notification.severity);
        const severityBadge = this.getSeverityBadge(notification.severity);

        // Inject styles once if not already present
        if (!document.getElementById('systemNotificationStyles')) {
            const styleEl = document.createElement('style');
            styleEl.id = 'systemNotificationStyles';
            styleEl.textContent = `
                #systemNotificationModal .btn-icon-close {
                    color: var(--hl-light, #f8f9fa);
                    background: none;
                    border: none;
                    cursor: pointer;
                    padding: 0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                #systemNotificationModal .btn-icon-close svg {
                    width: 1.5em;
                    height: 1.5em;
                }
                #systemNotificationModal .btn-icon-close:hover {
                    opacity: 0.75;
                }
            `;
            document.head.appendChild(styleEl);
        }

        const modalHtml = `
            <div class="modal fade" id="systemNotificationModal" data-bs-backdrop="static" data-bs-keyboard="false" tabindex="-1" aria-labelledby="systemNotificationModalLabel" aria-hidden="true" data-notification-id="${this.escapeHtml(notification.notificationId)}">
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title" id="systemNotificationModalLabel">
                                <i class="bi ${severityIcon} me-2"></i>${this.escapeHtml(notification.title)}
                                <span class="badge ${severityBadge} ms-2">${notification.severity.toUpperCase()}</span>
                            </h5>
                            <button type="button" class="btn-icon-close" aria-label="Close" data-dismiss-notification>${getIconSvg('bi-x-circle-fill')}</button>
                        </div>
                        <div class="modal-body">
                            ${notification.message}
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-primary" data-dismiss-notification>
                                Got it
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        const div = document.createElement('div');
        div.innerHTML = modalHtml.trim();
        return div.firstElementChild as HTMLElement;
    }

    /**
     * Mark notification as dismissed on server and locally
     */
    private async dismissNotification(notificationId: string): Promise<void> {
        try {
            // Save to server
            await this.apiClient.id(`${notificationId}/dismiss`).create();

            // Save to localStorage as backup
            this.markDismissedLocally(notificationId);

            logger.info(`Dismissed notification: ${notificationId}`);
        } catch (error) {
            logger.error('Failed to dismiss notification:', error);
            // Still mark locally so user doesn't see it again this session
            this.markDismissedLocally(notificationId);
        }
    }

    /**
     * Check if notification was dismissed in localStorage
     */
    private isAlreadyDismissedLocally(notificationId: string): boolean {
        const dismissed = localStorage.getItem(SystemNotificationManager.DISMISSED_KEY);
        if (!dismissed) return false;

        try {
            const parsed: unknown = JSON.parse(dismissed);
            return Array.isArray(parsed) && parsed.every(value => typeof value === 'string') && parsed.includes(notificationId);
        } catch (error) {
            logger.error('Failed to parse dismissed notifications from localStorage:', error);
            return false;
        }
    }

    /**
     * Mark notification as dismissed in localStorage
     */
    private markDismissedLocally(notificationId: string): void {
        try {
            const dismissed = localStorage.getItem(SystemNotificationManager.DISMISSED_KEY);
            const parsed: unknown = dismissed ? JSON.parse(dismissed) : [];
            const dismissedList = Array.isArray(parsed) && parsed.every(value => typeof value === 'string') ? parsed : [];

            if (!Array.isArray(dismissedList)) {
                localStorage.setItem(SystemNotificationManager.DISMISSED_KEY, JSON.stringify([notificationId]));
                return;
            }

            if (!dismissedList.includes(notificationId)) {
                dismissedList.push(notificationId);
                localStorage.setItem(SystemNotificationManager.DISMISSED_KEY, JSON.stringify(dismissedList));
            }
        } catch (error) {
            logger.error('Failed to save dismissed notification to localStorage:', error);
        }
    }

    /**
     * Remove modal from DOM
     */
    private removeModal(): void {
        if (this.modalElement) {
            this.modalElement.remove();
            this.modalElement = null;
        }
        // Also remove any backdrop that might be left behind
        const backdrop = document.querySelector('.modal-backdrop');
        backdrop?.remove();
    }

    /**
     * Get Bootstrap icon for severity
     */
    private getSeverityIcon(severity: string): string {
        switch (severity) {
            case 'critical':
                return 'bi-exclamation-triangle-fill';
            case 'warning':
                return 'bi-exclamation-circle-fill';
            case 'info':
            default:
                return 'bi-info-circle-fill';
        }
    }

    /**
     * Get Bootstrap badge class for severity
     */
    private getSeverityBadge(severity: string): string {
        switch (severity) {
            case 'critical':
                return 'bg-danger';
            case 'warning':
                return 'bg-primary';
            case 'info':
            default:
                return 'bg-secondary';
        }
    }

    /**
     * Basic HTML escape for safety
     */
    private escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Type definition for Bootstrap Modal
interface BootstrapModalConstructor {
    new (element: HTMLElement, options?: { backdrop?: string | boolean; keyboard?: boolean }): BootstrapModal;
}

interface BootstrapModal {
    show(): void;
    hide(): void;
}
