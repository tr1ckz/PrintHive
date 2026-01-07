# Contributing to Bambu Lab Integration

Thank you for your interest in contributing to this project! Here are some guidelines to help you get started.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/printhive.git`
3. Create a feature branch: `git checkout -b feature/your-feature-name`
4. Make your changes
5. Test thoroughly
6. Commit with clear messages: `git commit -m "Add: feature description"`
7. Push to your fork: `git push origin feature/your-feature-name`
8. Open a Pull Request

## Development Setup

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Start development server
npm run dev
```

## Code Style

- Use TypeScript for frontend code
- Follow existing code formatting
- Add comments for complex logic
- Keep functions focused and small

## Testing

- Test your changes locally before submitting
- Verify Docker build works: `docker-compose build`
- Check for console errors in browser developer tools
- Test with different printer models if possible

## Pull Request Guidelines

- **Title**: Clear and descriptive (e.g., "Add: support for X1 Carbon", "Fix: cover image loading")
- **Description**: Explain what changes you made and why
- **Screenshots**: Include for UI changes
- **Testing**: Describe how you tested your changes

## Bug Reports

When reporting bugs, please include:
- Steps to reproduce
- Expected behavior
- Actual behavior
- Browser/OS information
- Console error messages
- Screenshots if applicable

## Feature Requests

- Check existing issues first
- Describe the use case
- Explain why it would benefit users
- Propose implementation if possible

## Code of Conduct

- Be respectful and professional
- Welcome newcomers
- Focus on constructive feedback
- Help others learn

## Questions?

Open an issue with the `question` label or reach out via the issue tracker.

Thank you for contributing! 🎉
