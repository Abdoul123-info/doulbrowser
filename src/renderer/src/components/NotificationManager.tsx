
import { useEffect, useState } from 'react';
// import { useTranslation } from '../utils/i18n';

interface NotificationData {
    title: string;
    body: string;
}

export function NotificationManager() {
    // const { t } = useTranslation(); // Unused for now as main sends strings
    const [, setSettings] = useState({ notifications: true, soundNotifications: false });

    useEffect(() => {
        // Load settings initially
        window.api.getSettings().then(setSettings);

        const handleNotification = (_event: any, data: NotificationData) => {
            // Re-fetch settings to ensure we have the latest (or optimize by using a context/store if available, 
            // but fetching here ensures robust compliance with settings modal changes)
            window.api.getSettings().then(currentSettings => {
                setSettings(currentSettings);

                if (currentSettings.notifications) {
                    // Request permission if needed (though usually granted in Electron)
                    if (Notification.permission === "granted") {
                        showSystemNotification(data.title, data.body, currentSettings.soundNotifications);
                    } else if (Notification.permission !== "denied") {
                        Notification.requestPermission().then(permission => {
                            if (permission === "granted") {
                                showSystemNotification(data.title, data.body, currentSettings.soundNotifications);
                            }
                        });
                    }
                }
            });
        };

        window.api.onNotification(handleNotification);

        // We do typically not remove listeners here if this component is persistent at App level
        // relying on the global cleanup might be risky if removed by other components.
        // Ideally we shouldn't use removeAllListeners globally in other components.
        // For now, we just listen.

        return () => {
            // If we had a specific remove listener, we would use it.
            // window.api.removeNotificationListener(handleNotification);
        }
    }, []);

    const showSystemNotification = (title: string, body: string, playSound: boolean) => {
        const notif = new Notification(title, {
            body: body,
            requireInteraction: false,
            silent: !playSound // If true, suppresses default OS sound. If false, OS might play sound.
        });

        // Manual sound fallback if OS sound is unreliable or we want a custom one
        // But for "native" feel, usually OS handles it if silent is false.
        // However, Electron window creation often has silent: false by default.

        notif.onclick = () => {
            window.focus();
        };
    };

    return null; // Logic only component
}
