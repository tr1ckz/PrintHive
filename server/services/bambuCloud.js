const axios = require('axios');

// Region-specific API endpoints
const REGIONS = {
  'us': 'https://api.bambulab.com',
  'eu': 'https://api.bambulab.com',
  'cn': 'https://api.bambulab.cn'
};

class BambuCloudService {
  constructor() {
    this.baseURL = 'https://api.bambulab.com';
  }

  // Login with email and password - the proper way!
  async loginWithCredentials(email, password) {
    try {
      // Try direct API login first
      const region = await this.detectRegion();
      const baseURL = REGIONS[region.toLowerCase()];
      
      const response = await axios.post(`${baseURL}/v1/user-service/user/login`, {
        account: email,
        password: password,
        apiError: ""
      }, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        timeout: 10000
      });

      if (response.data && response.data.accessToken) {
        return {
          success: true,
          token: response.data.accessToken,
          refreshToken: response.data.refreshToken,
          region: region,
          userInfo: response.data
        };
      }

      // Try web-based login as fallback
      const webResult = await this.webLogin(email, password);
      if (webResult.success) {
        return {
          success: true,
          token: webResult.token,
          region: region
        };
      }

      return {
        success: false,
        error: 'Invalid email or password'
      };

    } catch (error) {
      console.error('Login error:', error.message);
      
      // If it's a verification code error, let user know
      if (error.response && error.response.data && 
          error.response.data.message && 
          error.response.data.message.includes('verification')) {
        return {
          success: false,
          error: 'Verification code required. Please login via Bambu Studio first or use access token instead.'
        };
      }

      return {
        success: false,
        error: 'Login failed: ' + (error.response?.data?.message || error.message)
      };
    }
  }

  // Web-based login fallback
  async webLogin(email, password) {
    try {
      // Get login form
      const formResponse = await axios.get('https://bambulab.com/en-us/sign-in', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      // Extract CSRF token
      const html = formResponse.data;
      const csrfMatch = html.match(/name="csrf[^"]*"\s+value="([^"]+)"/);
      const csrf = csrfMatch ? csrfMatch[1] : null;

      if (!csrf) {
        return { success: false, error: 'Could not get login form' };
      }

      // Submit login
      const loginData = new URLSearchParams();
      loginData.append('email', email);
      loginData.append('password', password);
      loginData.append('csrf', csrf);

      const loginResponse = await axios.post('https://bambulab.com/api/sign-in', loginData, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://bambulab.com/en-us/sign-in'
        },
        maxRedirects: 0,
        validateStatus: status => status < 400
      });

      // Extract token from cookies
      const cookies = loginResponse.headers['set-cookie'] || [];
      for (const cookie of cookies) {
        if (cookie.includes('token=') || cookie.includes('access_token=')) {
          const tokenMatch = cookie.match(/(?:token|access_token)=([^;]+)/);
          if (tokenMatch) {
            return {
              success: true,
              token: tokenMatch[1]
            };
          }
        }
      }

      return { success: false, error: 'No token received' };

    } catch (error) {
      return { success: false, error: 'Web login failed' };
    }
  }

  // Detect region from IP
  async detectRegion() {
    try {
      const response = await axios.get('https://ipapi.co/json/', { timeout: 5000 });
      const country = response.data.country_code;
      
      console.log('Detected country:', country);
      
      // China uses .cn domain
      if (country === 'CN') {
        return 'cn';
      }
      // Europe
      if (['GB', 'DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT', 'CH', 'SE', 'NO', 'DK', 'FI', 'PL', 'CZ', 'IE'].includes(country)) {
        return 'eu';
      }
      // Default to US
      return 'us';
    } catch (error) {
      console.log('Failed to detect region, defaulting to US');
      return 'us';
    }
  }
  
  getApiUrl(region = 'us') {
    return REGIONS[region] || REGIONS['us'];
  }

  /**
   * Alternative: Login with auth token (if user already has one)
   * @param {string} authToken - Pre-existing auth token
   * @param {string} region - Optional region, will auto-detect if not provided
   * @returns {Promise<Object>} Validation response
   */
  async loginWithToken(authToken, region = null) {
    try {
      // Detect region if not provided
      if (!region) {
        region = await this.detectRegion();
        console.log('Detected region:', region);
      }
      
      const apiUrl = this.getApiUrl(region);
      console.log('Using API URL:', apiUrl);
      
      // Test the token by fetching user's printers
      const response = await axios.get(`${apiUrl}/v1/iot-service/api/user/bind`, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });
      
      return {
        success: true,
        token: authToken,
        region: region
      };
    } catch (error) {
      console.error('Token validation error:', error.response?.data || error.message);
      return {
        success: false,
        error: 'Invalid auth token'
      };
    }
  }

  /**
   * Get user's printers
   * @param {string} token - Access token
   * @param {string} region - Region code
   * @returns {Promise<Array>} List of printers
   */
  async getPrinters(token, region = 'us') {
    try {
      const apiUrl = this.getApiUrl(region);
      console.log('Fetching printers from:', apiUrl);
      
      const response = await axios.get(`${apiUrl}/v1/iot-service/api/user/bind`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      console.log('Printers API response:', JSON.stringify(response.data, null, 2));
      
      // Handle different response structures
      const devices = response.data.devices || response.data.data?.devices || response.data || [];
      
      return {
        success: true,
        printers: Array.isArray(devices) ? devices : []
      };
    } catch (error) {
      console.error('Get printers error:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.message || 'Failed to fetch printers'
      };
    }
  }

  /**
   * Get print history/models
   * @param {string} token - Access token
   * @param {string} region - Region code
   * @returns {Promise<Array>} Print history
   */
  async getPrintHistory(token, region = 'us') {
    try {
      const apiUrl = this.getApiUrl(region);
      console.log('Fetching print history from:', apiUrl);
      
      const response = await axios.get(`${apiUrl}/v1/user-service/my/tasks`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      console.log('Print history response:', JSON.stringify(response.data, null, 2));
      
      const tasks = response.data.tasks || response.data.data?.tasks || response.data || [];
      
      return {
        success: true,
        models: Array.isArray(tasks) ? tasks : []
      };
    } catch (error) {
      console.error('Get print history error:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.message || 'Failed to fetch print history'
      };
    }
  }

  /**
   * Get timelapses
   * @param {string} token - Access token
   * @param {string} region - Region code
   * @returns {Promise<Array>} Timelapses
   */
  async getTimelapses(token, region = 'us') {
    try {
      // Timelapses are part of the tasks data, not a separate endpoint
      const tasksResult = await this.getPrintHistory(token, region);
      
      if (!tasksResult.success) {
        return tasksResult;
      }

      // Filter tasks that have timelapse videos
      const timelapses = tasksResult.models.filter(task => 
        task.videoUrl || 
        task.video_url || 
        task.timelapse ||
        task.cover?.includes('.mp4') ||
        task.coverUrl?.includes('.mp4')
      );
      
      console.log(`Found ${timelapses.length} tasks with timelapses`);
      
      return {
        success: true,
        timelapses: timelapses
      };
    } catch (error) {
      console.error('Get timelapses error:', error.message);
      return {
        success: false,
        error: 'Failed to fetch timelapses'
      };
    }
  }

  /**
   * Get timelapse video URL for a specific model
   * @param {string} modelId - Model ID
   * @param {string} token - Access token
   * @param {string} region - Region code
   * @returns {Promise<Object>} Timelapse URL
   */
  async getTimelapseUrl(modelId, token, region = 'us') {
    try {
      console.log('=== TIMELAPSE REQUEST ===');
      console.log('Model ID:', modelId);
      
      // Get print history which includes timelapse data
      const tasksResult = await this.getPrintHistory(token, region);
      
      if (!tasksResult.success) {
        return tasksResult;
      }

      // Find the task matching this modelId
      const task = tasksResult.models.find(t => 
        t.modelId === modelId || 
        t.model_id === modelId ||
        t.taskId === modelId ||
        t.task_id === modelId ||
        t.id === modelId ||
        String(t.id) === String(modelId)
      );

      if (!task) {
        console.log('Task not found for modelId:', modelId);
        console.log('Available tasks:', tasksResult.models.slice(0, 5).map(t => ({
          id: t.id, 
          modelId: t.modelId, 
          title: t.title
        })));
        return {
          success: false,
          error: 'Print task not found'
        };
      }

      console.log('Task found:', {
        id: task.id,
        modelId: task.modelId,
        title: task.title,
        videoUrl: task.videoUrl,
        cover: task.cover?.substring(0, 100)
      });

      // Check if task has video URL directly in the data
      let videoUrl = task.videoUrl || task.video_url || task.timelapse;
      
      // If no direct video URL, try to construct the API endpoint
      if (!videoUrl && task.id) {
        const apiUrl = this.getApiUrl(region);
        const taskId = task.id;
        const videoEndpoint = `${apiUrl}/v1/iot-service/api/user/task/${taskId}/video`;
        
        console.log('Fetching timelapse from:', videoEndpoint);
        
        try {
          // Try to fetch the video URL from the API
          const response = await axios.get(videoEndpoint, {
            headers: {
              'Authorization': `Bearer ${token}`
            },
            maxRedirects: 0,
            validateStatus: (status) => status < 400 || status === 302 || status === 301
          });
          
          // The API might return the video URL in the response or as a redirect
          if (response.data?.url || response.data?.videoUrl) {
            videoUrl = response.data.url || response.data.videoUrl;
          } else if (response.headers?.location) {
            videoUrl = response.headers.location;
          } else if (response.data) {
            // Sometimes the response itself is the video data
            videoUrl = videoEndpoint;
          }
        } catch (error) {
          console.log('Timelapse error:', error.message);
          // If 404, the timelapse doesn't exist
          if (error.response?.status === 404) {
            return {
              success: false,
              error: 'No timelapse video available for this print'
            };
          }
        }
      }
      
      if (!videoUrl) {
        // Last resort: check if cover image is actually a video
        if (task.cover && (task.cover.includes('.mp4') || task.cover.includes('.mov'))) {
          videoUrl = task.cover;
        } else {
          return {
            success: false,
            error: 'No timelapse video available for this print'
          };
        }
      }

      console.log('Video URL found:', videoUrl);

      return {
        success: true,
        url: videoUrl,
        task: task
      };
    } catch (error) {
      console.error('Get timelapse URL error:', error.message);
      return {
        success: false,
        error: 'Failed to fetch timelapse URL'
      };
    }
  }
  }
}

module.exports = new BambuCloudService();
