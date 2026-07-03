const axios = require('axios');

class BambuAuth {
    constructor() {
        this.baseURL = 'https://bambulab.com';
        this.apiURL = 'https://api.bambulab.com';
    }

    // Get login form with CSRF token
    async getLoginForm() {
        try {
            const response = await axios.get(`${this.baseURL}/en-us/sign-in`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });
            
            // Extract CSRF token from the HTML
            const html = response.data;
            const csrfMatch = html.match(/name="csrf[^"]*"\s+value="([^"]+)"/);
            const sessionMatch = html.match(/name="_session[^"]*"\s+value="([^"]+)"/);
            
            return {
                csrf: csrfMatch ? csrfMatch[1] : null,
                session: sessionMatch ? sessionMatch[1] : null,
                cookies: this.parseCookies(response.headers['set-cookie'] || [])
            };
        } catch (error) {
            console.error('Error getting login form:', error.message);
            return null;
        }
    }

    // Perform login with email/password
    async login(email, password) {
        try {
            // Step 1: Get login form and tokens
            const formData = await this.getLoginForm();
            if (!formData) {
                return { success: false, error: 'Failed to get login form' };
            }

            // Step 2: Submit login form
            const loginData = new URLSearchParams();
            loginData.append('email', email);
            loginData.append('password', password);
            if (formData.csrf) loginData.append('csrf', formData.csrf);
            if (formData.session) loginData.append('_session', formData.session);

            const loginResponse = await axios.post(`${this.baseURL}/api/sign-in`, loginData, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Cookie': this.formatCookies(formData.cookies),
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Referer': `${this.baseURL}/en-us/sign-in`,
                    'X-Requested-With': 'XMLHttpRequest'
                },
                maxRedirects: 0,
                validateStatus: status => status < 400
            });

            // Step 3: Extract auth token from response
            const authCookies = this.parseCookies(loginResponse.headers['set-cookie'] || []);
            const accessToken = authCookies.find(c => c.name === 'token' || c.name === 'access_token' || c.name === 'auth_token');
            
            if (accessToken) {
                return {
                    success: true,
                    token: accessToken.value,
                    cookies: authCookies
                };
            }

            // Check if we need verification code
            if (loginResponse.data && loginResponse.data.includes('verification')) {
                return {
                    success: false,
                    error: 'Verification code required',
                    needsVerification: true
                };
            }

            return {
                success: false,
                error: 'Login failed - no token received'
            };

        } catch (error) {
            console.error('Login error:', error.message);
            return {
                success: false,
                error: `Login failed: ${error.message}`
            };
        }
    }

    // Try alternative API login endpoint
    async apiLogin(email, password) {
        try {
            const response = await axios.post(`${this.apiURL}/v1/user-service/user/login`, {
                account: email,
                password: password,
                apiError: ""
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            if (response.data && response.data.accessToken) {
                return {
                    success: true,
                    token: response.data.accessToken,
                    refreshToken: response.data.refreshToken,
                    userId: response.data.userId
                };
            }

            return {
                success: false,
                error: 'API login failed'
            };

        } catch (error) {
            console.error('API login error:', error.message);
            return {
                success: false,
                error: `API login failed: ${error.message}`
            };
        }
    }

    // Parse cookies from Set-Cookie headers
    parseCookies(setCookieHeaders) {
        return setCookieHeaders.map(cookie => {
            const [nameValue, ...attributes] = cookie.split(';');
            const [name, value] = nameValue.split('=');
            return {
                name: name.trim(),
                value: value ? value.trim() : '',
                attributes: attributes.map(attr => attr.trim())
            };
        });
    }

    // Format cookies for Cookie header
    formatCookies(cookies) {
        return cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
    }
}

module.exports = new BambuAuth();