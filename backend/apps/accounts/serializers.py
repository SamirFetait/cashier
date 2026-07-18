from django.contrib.auth import get_user_model
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=False, allow_blank=False)
    # Write-only: the PIN itself is never returned, only whether one is set.
    override_pin = serializers.CharField(
        write_only=True, required=False, allow_blank=True, min_length=4, max_length=12
    )
    has_override_pin = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id", "username", "first_name", "last_name", "email",
            "phone_number", "role", "is_active", "password",
            "override_pin", "has_override_pin", "date_joined",
        ]
        read_only_fields = ["date_joined"]

    def get_has_override_pin(self, obj) -> bool:
        return bool(obj.override_pin)

    def validate_override_pin(self, value):
        if value and not value.isdigit():
            raise serializers.ValidationError("The PIN must be digits only.")
        return value

    def create(self, validated_data):
        password = validated_data.pop("password", None)
        pin = validated_data.pop("override_pin", None)
        user = User(**validated_data)
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        if pin:
            user.set_override_pin(pin)
        user.save()
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop("password", None)
        pin = validated_data.pop("override_pin", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        if password:
            instance.set_password(password)
        if pin is not None:
            instance.set_override_pin(pin)
        instance.save()
        return instance


class CashierTokenObtainPairSerializer(TokenObtainPairSerializer):
    """Adds role to the token payload and returns the user in the response."""

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["role"] = user.role
        token["username"] = user.username
        return token

    def validate(self, attrs):
        data = super().validate(attrs)
        data["user"] = UserSerializer(self.user).data
        return data
