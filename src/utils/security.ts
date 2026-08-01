import axios from 'axios';

export const SecurityUtils = {
    checkVPN: async (ip: string) => {
        try {
            // Development lo localhost unte skip chesthunnam
            if (ip === '::1' || ip === '127.0.0.1') return false;

            const response = await axios.get(`http://ip-api.com/json/${ip}?fields=proxy,hosting`);
            
            // Proxy (VPN) or Hosting (Data center) ayithe true return chestundi
            if (response.data.proxy === true || response.data.hosting === true) {
                return true;
            }
            return false;
        } catch (error) {
            console.error('Security Check Error:', error);
            return false; // Error vasthe safe side allow chesthunnam
        }
    }
};