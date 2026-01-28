"""
Serializers for authentication and user management.
"""
from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from skyspy.models.auth import (
    SkyspyUser, Role, UserRole, APIKey, FeatureAccess, OIDCClaimMapping,
    ALL_PERMISSIONS,
)


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    """
    Custom JWT token serializer that includes user info in the response.
    """

    def validate(self, attrs):
        data = super().validate(attrs)

        # Add user info to response
        user = self.user
        data['user'] = {
            'id': user.id,
            'username': user.username,
            'email': user.email,
        }

        # Add profile info
        try:
            profile = user.skyspy_profile
            data['user']['display_name'] = profile.display_name
            data['user']['permissions'] = profile.get_all_permissions()
            data['user']['roles'] = [
                ur.role.name for ur in user.user_roles.all()
            ]
        except SkyspyUser.DoesNotExist:
            data['user']['permissions'] = []
            data['user']['roles'] = []

        return data


class LoginSerializer(serializers.Serializer):
    """Serializer for local login."""
    username = serializers.CharField()
    password = serializers.CharField(write_only=True)


class SkyspyUserSerializer(serializers.ModelSerializer):
    """Serializer for SkyspyUser profile."""
    # Use user.id as the primary identifier for API consumers
    id = serializers.IntegerField(source='user.id', read_only=True)
    username = serializers.CharField(source='user.username', read_only=True)
    email = serializers.EmailField(source='user.email', read_only=True)
    first_name = serializers.CharField(source='user.first_name', read_only=True)
    last_name = serializers.CharField(source='user.last_name', read_only=True)
    is_active = serializers.BooleanField(source='user.is_active', read_only=True)
    permissions = serializers.SerializerMethodField()
    roles = serializers.SerializerMethodField()

    class Meta:
        model = SkyspyUser
        fields = [
            'id', 'username', 'email', 'first_name', 'last_name',
            'display_name', 'avatar_url', 'auth_provider',
            'is_active', 'last_active', 'preferences',
            'permissions', 'roles', 'created_at',
        ]
        read_only_fields = ['id', 'auth_provider', 'last_active', 'created_at']

    def get_permissions(self, obj):
        return obj.get_all_permissions()

    def get_roles(self, obj):
        return [
            {'name': ur.role.name, 'display_name': ur.role.display_name}
            for ur in obj.user.user_roles.all()
        ]


class UserProfileSerializer(serializers.ModelSerializer):
    """Serializer for current user's profile (editable fields)."""
    username = serializers.CharField(source='user.username', read_only=True)
    email = serializers.EmailField(source='user.email', read_only=True)
    permissions = serializers.SerializerMethodField()
    roles = serializers.SerializerMethodField()

    class Meta:
        model = SkyspyUser
        fields = [
            'id', 'username', 'email', 'display_name', 'avatar_url',
            'preferences', 'permissions', 'roles',
        ]
        read_only_fields = ['id']

    def get_permissions(self, obj):
        return obj.get_all_permissions()

    def get_roles(self, obj):
        return [ur.role.name for ur in obj.user.user_roles.all()]


class UserCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating new users."""
    username = serializers.CharField()
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, required=False, allow_blank=True)
    display_name = serializers.CharField(required=False, allow_blank=True)
    roles = serializers.ListField(
        child=serializers.CharField(),
        required=False,
        write_only=True
    )
    role_ids = serializers.ListField(
        child=serializers.IntegerField(),
        required=False,
        write_only=True
    )

    class Meta:
        model = User
        fields = ['username', 'email', 'password', 'first_name', 'last_name', 'display_name', 'roles', 'role_ids']

    def validate_username(self, value):
        """Ensure username is unique."""
        if User.objects.filter(username=value).exists():
            raise serializers.ValidationError("A user with this username already exists.")
        return value

    def validate_email(self, value):
        """Ensure email is unique."""
        if User.objects.filter(email=value).exists():
            raise serializers.ValidationError("A user with this email already exists.")
        return value

    def validate_password(self, value):
        """Validate password if provided."""
        if value:
            validate_password(value)
        return value

    def create(self, validated_data):
        import secrets

        roles = validated_data.pop('roles', [])
        role_ids = validated_data.pop('role_ids', [])
        display_name = validated_data.pop('display_name', '')
        password = validated_data.pop('password', None)

        # Generate random password if not provided
        if not password:
            password = secrets.token_urlsafe(16)

        user = User.objects.create_user(**validated_data)
        user.set_password(password)
        user.save()

        # Create profile
        SkyspyUser.objects.create(
            user=user,
            display_name=display_name or user.username,
            auth_provider='local'
        )

        # Assign roles by name
        for role_name in roles:
            try:
                role = Role.objects.get(name=role_name)
                UserRole.objects.create(user=user, role=role)
            except Role.DoesNotExist:
                pass

        # Assign roles by ID
        for role_id in role_ids:
            try:
                role = Role.objects.get(id=role_id)
                # Check if this role assignment already exists (to avoid duplicates)
                if not UserRole.objects.filter(user=user, role=role).exists():
                    UserRole.objects.create(user=user, role=role)
            except Role.DoesNotExist:
                pass

        return user


class UserUpdateSerializer(serializers.ModelSerializer):
    """Serializer for updating users."""
    username = serializers.CharField(source='user.username', required=False)
    email = serializers.EmailField(source='user.email', required=False)
    first_name = serializers.CharField(source='user.first_name', required=False, allow_blank=True)
    last_name = serializers.CharField(source='user.last_name', required=False, allow_blank=True)
    is_active = serializers.BooleanField(source='user.is_active', required=False)
    password = serializers.CharField(write_only=True, required=False, validators=[validate_password])
    roles = serializers.ListField(
        child=serializers.CharField(),
        required=False,
        write_only=True
    )

    class Meta:
        model = SkyspyUser
        fields = [
            'username', 'email', 'first_name', 'last_name', 'is_active',
            'display_name', 'password', 'roles', 'preferences'
        ]

    def validate(self, attrs):
        """Validate uniqueness of username and email."""
        user_data = attrs.get('user', {})

        # Check username uniqueness
        if 'username' in user_data:
            new_username = user_data['username']
            if User.objects.filter(username=new_username).exclude(id=self.instance.user.id).exists():
                raise serializers.ValidationError({'username': 'A user with this username already exists.'})

        # Check email uniqueness
        if 'email' in user_data:
            new_email = user_data['email']
            if User.objects.filter(email=new_email).exclude(id=self.instance.user.id).exists():
                raise serializers.ValidationError({'email': 'A user with this email already exists.'})

        return attrs

    def update(self, instance, validated_data):
        # Handle nested user fields
        user_data = {}
        if 'user' in validated_data:
            user_data = validated_data.pop('user')

        # Handle password
        password = validated_data.pop('password', None)

        # Handle roles
        roles = validated_data.pop('roles', None)

        # Update user fields
        user = instance.user
        if 'username' in user_data:
            user.username = user_data['username']
        if user_data.get('email'):
            user.email = user_data['email']
        if 'first_name' in user_data:
            user.first_name = user_data['first_name']
        if 'last_name' in user_data:
            user.last_name = user_data['last_name']
        if 'is_active' in user_data:
            user.is_active = user_data['is_active']
        if password:
            user.set_password(password)
        user.save()

        # Update profile fields
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()

        # Update roles if provided
        if roles is not None:
            # Remove existing roles
            UserRole.objects.filter(user=user).delete()
            # Add new roles
            for role_name in roles:
                try:
                    role = Role.objects.get(name=role_name)
                    UserRole.objects.create(user=user, role=role)
                except Role.DoesNotExist:
                    pass

        return instance


class RoleSerializer(serializers.ModelSerializer):
    """Serializer for roles."""
    user_count = serializers.SerializerMethodField()

    class Meta:
        model = Role
        fields = [
            'id', 'name', 'display_name', 'description', 'permissions',
            'is_system', 'priority', 'user_count', 'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'is_system', 'created_at', 'updated_at']

    def get_user_count(self, obj):
        return obj.user_assignments.count()

    def validate_permissions(self, value):
        """Validate that all permissions are valid."""
        invalid = [p for p in value if p not in ALL_PERMISSIONS]
        if invalid:
            raise serializers.ValidationError(
                f"Invalid permissions: {', '.join(invalid)}"
            )
        return value


class UserRoleSerializer(serializers.ModelSerializer):
    """Serializer for user-role assignments."""
    user_id = serializers.IntegerField(source='user.id', read_only=True)
    username = serializers.CharField(source='user.username', read_only=True)
    role_id = serializers.IntegerField(source='role.id', read_only=True)
    role_name = serializers.CharField(source='role.name', read_only=True)
    role_display_name = serializers.CharField(source='role.display_name', read_only=True)
    assigned_by_username = serializers.CharField(source='assigned_by.username', read_only=True)
    is_expired = serializers.SerializerMethodField()

    class Meta:
        model = UserRole
        fields = [
            'id', 'user', 'user_id', 'username', 'role', 'role_id', 'role_name', 'role_display_name',
            'expires_at', 'is_expired', 'assigned_by', 'assigned_by_username', 'created_at'
        ]
        read_only_fields = ['id', 'assigned_by', 'created_at']

    def get_is_expired(self, obj):
        return obj.is_expired


class APIKeySerializer(serializers.ModelSerializer):
    """Serializer for API keys."""
    key = serializers.CharField(read_only=True)
    user_id = serializers.IntegerField(source='user.id', read_only=True)

    class Meta:
        model = APIKey
        fields = [
            'id', 'user_id', 'name', 'key', 'key_prefix', 'scopes',
            'is_active', 'expires_at', 'last_used_at', 'created_at'
        ]
        read_only_fields = ['id', 'user_id', 'key', 'key_prefix', 'last_used_at', 'created_at']


class APIKeyCreateSerializer(serializers.Serializer):
    """Serializer for creating API keys."""
    name = serializers.CharField(max_length=100)
    user_id = serializers.IntegerField(required=False)
    scopes = serializers.ListField(
        child=serializers.CharField(),
        required=False,
        default=list
    )
    expires_at = serializers.DateTimeField(required=False, allow_null=True)

    def validate_scopes(self, value):
        """Validate that all scopes are valid permissions."""
        invalid = [s for s in value if s not in ALL_PERMISSIONS]
        if invalid:
            raise serializers.ValidationError(
                f"Invalid scopes: {', '.join(invalid)}"
            )
        return value

    def validate_user_id(self, value):
        """Validate that user exists."""
        if value:
            try:
                User.objects.get(id=value)
            except User.DoesNotExist:
                raise serializers.ValidationError("User not found")
        return value

    def create(self, validated_data):
        # Use provided user_id or fall back to request user
        user_id = validated_data.pop('user_id', None)
        if user_id:
            user = User.objects.get(id=user_id)
        else:
            user = self.context['request'].user

        # Generate key
        key, key_hash, key_prefix = APIKey.generate_key()

        api_key = APIKey.objects.create(
            user=user,
            name=validated_data['name'],
            key_hash=key_hash,
            key_prefix=key_prefix,
            scopes=validated_data.get('scopes', []),
            expires_at=validated_data.get('expires_at'),
        )

        # Attach the raw key for the response (only shown once)
        api_key.key = key
        return api_key


class FeatureAccessSerializer(serializers.ModelSerializer):
    """Serializer for feature access configuration."""
    feature_display = serializers.CharField(source='get_feature_display', read_only=True)

    class Meta:
        model = FeatureAccess
        fields = [
            'feature', 'feature_display', 'read_access', 'write_access',
            'is_enabled', 'settings', 'updated_at'
        ]


class OIDCClaimMappingSerializer(serializers.ModelSerializer):
    """Serializer for OIDC claim mappings."""
    role_name = serializers.CharField(source='role.name', read_only=True)
    role_display_name = serializers.CharField(source='role.display_name', read_only=True)
    role_id = serializers.IntegerField(source='role.id', read_only=True)

    class Meta:
        model = OIDCClaimMapping
        fields = [
            'id', 'name', 'claim_name', 'match_type', 'claim_value',
            'role', 'role_id', 'role_name', 'role_display_name',
            'priority', 'is_active', 'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'role_id', 'created_at', 'updated_at']
        extra_kwargs = {'role': {'required': False}}

    def to_internal_value(self, data):
        """Handle role_id in input data."""
        if 'role_id' in data and 'role' not in data:
            try:
                role = Role.objects.get(id=data['role_id'])
                data = data.copy()
                data['role'] = role.id
            except Role.DoesNotExist:
                raise serializers.ValidationError({'role_id': 'Role not found'})
        return super().to_internal_value(data)


class AuthConfigSerializer(serializers.Serializer):
    """Serializer for authentication configuration (public endpoint)."""
    auth_mode = serializers.CharField()
    auth_enabled = serializers.BooleanField()
    oidc_enabled = serializers.BooleanField()
    oidc_provider_name = serializers.CharField(allow_blank=True)
    local_auth_enabled = serializers.BooleanField()
    api_key_enabled = serializers.BooleanField()


class PermissionListSerializer(serializers.Serializer):
    """Serializer for listing available permissions."""
    feature = serializers.CharField()
    permissions = serializers.ListField(child=serializers.CharField())


class PasswordChangeSerializer(serializers.Serializer):
    """Serializer for changing password."""
    current_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True, validators=[validate_password])

    def validate_current_password(self, value):
        user = self.context['request'].user
        if not user.check_password(value):
            raise serializers.ValidationError("Current password is incorrect")
        return value

    def save(self):
        user = self.context['request'].user
        user.set_password(self.validated_data['new_password'])
        user.save()
        return user
