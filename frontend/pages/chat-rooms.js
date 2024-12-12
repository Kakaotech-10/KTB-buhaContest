import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import ReactDOM from 'react-dom';
import styles from './Modal.module.css';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import { Card } from '@goorm-dev/vapor-core';
import {
  Button,
  Status,
  Spinner,
  Text,
  Alert,
} from '@goorm-dev/vapor-components';
import {
  HScrollTable,
  useHScrollTable,
  cellHelper,
} from '@goorm-dev/vapor-tables';
import { Lock, AlertCircle, WifiOff, RefreshCcw } from 'lucide-react';
import socketService from '../services/socket';
import authService from '../services/authService';
import axiosInstance from '../services/axios';
import { withAuth } from '../middleware/withAuth';
import { Toast } from '../components/Toast';

const API_URL = process.env.NEXT_PUBLIC_API_URL;

const CONNECTION_STATUS = {
  CHECKING: 'checking',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  ERROR: 'error',
};

const STATUS_CONFIG = {
  [CONNECTION_STATUS.CHECKING]: { label: '연결 확인 중...', color: 'warning' },
  [CONNECTION_STATUS.CONNECTING]: { label: '연결 중...', color: 'warning' },
  [CONNECTION_STATUS.CONNECTED]: { label: '연결됨', color: 'success' },
  [CONNECTION_STATUS.DISCONNECTED]: { label: '연결 끊김', color: 'danger' },
  [CONNECTION_STATUS.ERROR]: { label: '연결 오류', color: 'danger' },
};

const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 5000,
  backoffFactor: 2,
  reconnectInterval: 30000,
};

const SCROLL_THRESHOLD = 50;
const SCROLL_DEBOUNCE_DELAY = 150;
const INITIAL_PAGE_SIZE = 10;

const LoadingIndicator = ({ text }) => (
  <div className="loading-indicator">
    <Spinner size="sm" className="mr-3" />
    <Text size="sm" color="secondary">
      {text}
    </Text>
  </div>
);

const TableWrapper = ({ children, onScroll, loadingMore, hasMore, rooms }) => {
  const tableRef = useRef(null);
  const scrollTimeoutRef = useRef(null);
  const lastScrollTime = useRef(Date.now());

  const handleScroll = useCallback(
    (e) => {
      const now = Date.now();
      const container = e.target;
      const { scrollHeight, scrollTop, clientHeight } = container;
      const distanceToBottom = scrollHeight - (scrollTop + clientHeight);

      if (distanceToBottom < SCROLL_THRESHOLD && !loadingMore && hasMore) {
        lastScrollTime.current = now;
        onScroll(); // 데이터 로딩 시작
      }
    },
    [loadingMore, hasMore, onScroll]
  );

  useEffect(() => {
    const container = tableRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll, { passive: true });
    }

    return () => {
      if (container) {
        container.removeEventListener('scroll', handleScroll);
      }
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = null;
      }
    };
  }, [handleScroll]);

  return (
    <div
      ref={tableRef}
      className="chat-rooms-table"
      style={{
        height: '430px',
        overflowY: 'auto',
        position: 'relative',
        borderRadius: '0.5rem',
        backgroundColor: 'var(--background-normal)',
        border: '1px solid var(--border-color)',
        scrollBehavior: 'smooth',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      {children}
      {loadingMore && (
        <div className="flex items-center justify-center gap-2 p-4 border-t border-gray-700">
          <LoadingIndicator text="추가 채팅방을 불러오는 중..." />
        </div>
      )}
      {!hasMore && rooms?.length > 0 && (
        <div className="p-4 text-center border-t border-gray-700">
          <Text size="sm" color="secondary">
            모든 채팅방을 불러왔습니다.
          </Text>
        </div>
      )}
    </div>
  );
};

function ChatRoomsComponent() {
  const router = useRouter();
  const [rooms, setRooms] = useState([]);
  const [error, setError] = useState(null);
  const [loadingState, setLoadingState] = useState({
    loading: true,
    loadingMore: false,
  });
  const [currentUser] = useState(authService.getCurrentUser());
  const [connectionStatus, setConnectionStatus] = useState(
    CONNECTION_STATUS.CHECKING
  );
  const [retryCount, setRetryCount] = useState(0);
  const [sorting, setSorting] = useState([{ id: 'createdAt', desc: true }]);
  const [pageIndex, setPageIndex] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [password, setPassword] = useState();
  const [roomIdForPassword, setRoomIdForPassword] = useState(null);

  const Modal = ({ visible, children, onClose }) => {
    if (!visible) return null;
  
    const modalRoot = typeof window !== 'undefined' ? document.getElementById('modal-root') : null;
  
    if (!modalRoot) {
      console.error('modal-root DOM element not found');
      return null;
    }
  
    return ReactDOM.createPortal(
      <div>
        <div className={styles['modal-backdrop']} onClick={onClose}></div>
        <div className={styles.modal}>
          {children}
        </div>
      </div>,
      modalRoot
    );
  };

  // Refs
  const socketRef = useRef(null);
  const isLoadingRef = useRef(false);

  const getRetryDelay = useCallback((retryCount) => {
    const delay =
      RETRY_CONFIG.baseDelay *
      Math.pow(RETRY_CONFIG.backoffFactor, retryCount) *
      (1 + Math.random() * 0.1);
    return Math.min(delay, RETRY_CONFIG.maxDelay);
  }, []);

  const handleAuthError = useCallback(
    async (error) => {
      try {
        if (
          error.response?.status === 401 ||
          error.response?.data?.code === 'TOKEN_EXPIRED'
        ) {
          const refreshed = await authService.refreshToken();
          if (refreshed) {
            return true;
          }
        }
        authService.logout();
        router.replace('/?error=session_expired');
        return false;
      } catch (error) {
        console.error('Auth error handling failed:', error);
        authService.logout();
        router.replace('/?error=auth_error');
        return false;
      }
    },
    [router]
  );

  const handleFetchError = useCallback(
    (error, isLoadingMore) => {
      let errorMessage = '채팅방 목록을 불러오는데 실패했습니다.';
      let errorType = 'danger';
      if (error.message === 'SERVER_UNREACHABLE') {
        errorMessage =
          '서버와 연결할 수 없습니다. 잠시 후 자동으로 재시도합니다.';
        errorType = 'warning';
        if (!isLoadingMore && retryCount < RETRY_CONFIG.maxRetries) {
          const delay = getRetryDelay(retryCount);
          setRetryCount((prev) => prev + 1);
          setTimeout(() => {
            fetchRooms(isLoadingMore);
          }, delay);
        }
      }
      setError({
        title: '채팅방 목록 로드 실패',
        message: errorMessage,
        type: errorType,
      });
      setConnectionStatus(CONNECTION_STATUS.ERROR);
    },
    [retryCount, getRetryDelay]
  );

  const attemptConnection = useCallback(
    async (retryAttempt = 0) => {
      try {
        setConnectionStatus(CONNECTION_STATUS.CONNECTING);
        const response = await axiosInstance.get('/health', {
          timeout: 5000,
          retries: 1,
        });
        if (response?.data?.status === 'ok' && response?.status === 200) {
          setConnectionStatus(CONNECTION_STATUS.CONNECTED);
          setRetryCount(0);
          return true;
        }
        throw new Error('Server not ready');
      } catch (error) {
        if (!error.response && retryAttempt < RETRY_CONFIG.maxRetries) {
          const delay = getRetryDelay(retryAttempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
          return attemptConnection(retryAttempt + 1);
        }
        setConnectionStatus(CONNECTION_STATUS.ERROR);
        return false;
      }
    },
    [getRetryDelay]
  );

  const fetchRooms = useCallback(
    async (isLoadingMore = false) => {
      if (!currentUser?.token || isLoadingRef.current) {
        return;
      }
      try {
        isLoadingRef.current = true;
        setLoadingState((prevState) => ({
          ...prevState,
          loading: isLoadingMore ? prevState.loading : true,
          loadingMore: isLoadingMore,
        }));

        if (!isLoadingMore) {
          setError(null);
        }

        await attemptConnection();

        const response = await axiosInstance.get('/api/rooms', {
          params: {
            page: isLoadingMore ? pageIndex : 0,
            pageSize: INITIAL_PAGE_SIZE,
            sortField: sorting[0]?.id,
            sortOrder: sorting[0]?.desc ? 'desc' : 'asc',
          },
        });

        if (!response?.data?.data) {
          throw new Error('INVALID_RESPONSE');
        }

        const { data, metadata } = response.data;
        setRooms((prev) =>
          isLoadingMore
            ? [
                ...prev,
                ...data.filter((room) => !prev.some((r) => r._id === room._id)),
              ]
            : data
        );
        setHasMore(data.length === INITIAL_PAGE_SIZE && metadata.hasMore);
        if (isInitialLoad) setIsInitialLoad(false);
      } catch (error) {
        handleFetchError(error, isLoadingMore);
      } finally {
        setLoadingState((prevState) => ({
          ...prevState,
          loading: false,
          loadingMore: false,
        }));
        isLoadingRef.current = false;
      }
    },
    [
      currentUser,
      pageIndex,
      sorting,
      isInitialLoad,
      attemptConnection,
      handleFetchError,
    ]
  );

  const handleLoadMore = useCallback(async () => {
    if (loadingState.loadingMore || !hasMore || isLoadingRef.current) return;
    try {
      setLoadingState((prevState) => ({ ...prevState, loadingMore: true }));
      isLoadingRef.current = true;
      setPageIndex((prev) => prev + 1);
      await fetchRooms(true);
    } catch (error) {
      handleFetchError(error, true);
    } finally {
      setLoadingState((prevState) => ({ ...prevState, loadingMore: false }));
      isLoadingRef.current = false;
    }
  }, [loadingState, hasMore, fetchRooms]);

  useEffect(() => {
    if (pageIndex > 0) {
      fetchRooms(true);
    }
  }, [pageIndex, fetchRooms]);

  // 페이지 인덱스 변경 시 데이터 로드
  useEffect(() => {
    if (pageIndex > 0) {
      fetchRooms(true);
    }
  }, [pageIndex, fetchRooms]);

  useEffect(() => {
    if (currentUser) {
      fetchRooms(false);
    }
  }, [currentUser, fetchRooms]);

  useEffect(() => {
    const handleOnline = () => {
      console.log('Network is online');
      setConnectionStatus(CONNECTION_STATUS.CONNECTING);
      lastLoadedPageRef.current = 0;
      setPageIndex(0);
      fetchRooms(false);
    };

    const handleOffline = () => {
      console.log('Network is offline');
      setConnectionStatus(CONNECTION_STATUS.DISCONNECTED);
      setError({
        title: '네트워크 연결 끊김',
        message: '인터넷 연결을 확인해주세요.',
        type: 'danger',
      });
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [fetchRooms]);

  const handlePasswordSubmit = async () => {
    if (!password) {
      setError({ message: '비밀번호를 입력해주세요.', type: 'danger' });
      return;
    }

    try {
      const response = await axiosInstance.post(
        `/api/rooms/${roomIdForPassword}/join`,
        { password },
        { timeout: 5000 }
      );

      if (response.data.success) {
        router.push(`/chat?room=${roomIdForPassword}`);
      }
    } catch (error) {
      console.error('Room join with password error:', error);
      setError({
        title: '채팅방 입장 실패',
        message: error.response?.data?.message || '비밀번호가 틀렸습니다.',
        type: 'danger',
      });
    } finally {
      setPasswordModalVisible(false); // 모달 닫기
    }
  };

  useEffect(() => {
    if (!currentUser?.token) return;

    let isSubscribed = true;

    const connectSocket = async () => {
      try {
        const socket = await socketService.connect({
          auth: {
            token: currentUser.token,
            sessionId: currentUser.sessionId,
          },
        });

        if (!isSubscribed || !socket) return;

        socketRef.current = socket;

        const handlers = {
          connect: () => {
            setConnectionStatus(CONNECTION_STATUS.CONNECTED);
            socket.emit('joinRoomList');
          },
          disconnect: (reason) => {
            setConnectionStatus(CONNECTION_STATUS.DISCONNECTED);
            console.log('Socket disconnected:', reason);
          },
          error: (error) => {
            console.error('Socket error:', error);
            setConnectionStatus(CONNECTION_STATUS.ERROR);
          },
          roomCreated: (newRoom) => {
            setRooms((prev) => {
              const updatedRooms = [newRoom, ...prev];
              previousRoomsRef.current = updatedRooms;
              return updatedRooms;
            });
          },
          roomDeleted: (roomId) => {
            setRooms((prev) => {
              const updatedRooms = prev.filter((room) => room._id !== roomId);
              previousRoomsRef.current = updatedRooms;
              return updatedRooms;
            });
          },
          roomUpdated: (updatedRoom) => {
            setRooms((prev) => {
              const updatedRooms = prev.map((room) =>
                room._id === updatedRoom._id ? updatedRoom : room
              );
              previousRoomsRef.current = updatedRooms;
              return updatedRooms;
            });
          },
        };

        Object.entries(handlers).forEach(([event, handler]) => {
          socket.on(event, handler);
        });
      } catch (error) {
        console.error('Socket connection error:', error);
        if (!isSubscribed) return;

        if (
          error.message?.includes('Authentication required') ||
          error.message?.includes('Invalid session')
        ) {
          handleAuthError({ response: { status: 401 } });
        }

        setConnectionStatus(CONNECTION_STATUS.ERROR);
      }
    };

    connectSocket();

    return () => {
      isSubscribed = false;
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [currentUser, handleAuthError]);

  const handleJoinRoom = async (roomId, hasPassword) => {
    console.log('Joining room:', roomId, 'Has password:', hasPassword); // 디버깅

    if (connectionStatus !== CONNECTION_STATUS.CONNECTED) {
      setError({
        title: '채팅방 입장 실패',
        message: '서버와 연결이 끊어져 있습니다.',
        type: 'danger',
      });
      return;
    }

    if (hasPassword) {
      setPasswordModalVisible(true);
      setRoomIdForPassword(roomId);
      console.log('Modal state updated:', true);
      return;
    }

    try {
      const response = await axiosInstance.post(
        `/api/rooms/${roomId}/join`,
        {},
        { timeout: 5000 }
      );

      if (response.data.success) {
        router.push(`/chat?room=${roomId}`);
      }
    } catch (error) {
      console.error('Room join error:', error);
      setError({
        title: '채팅방 입장 실패',
        message: '입장에 실패했습니다.',
        type: 'danger',
      });
    }
  };

  const columns = useMemo(
    () => [
      {
        accessorKey: 'name',
        header: '채팅방',
        cell: cellHelper(({ value, rowData }) => (
          <div className="d-flex align-items-center gap-2">
            <Text className="font-medium">{value}</Text>
            {rowData.hasPassword && (
              <Lock size={14} className="text-gray-500" />
            )}
          </div>
        )),
        size: 200,
        enableSorting: true,
      },
      {
        accessorKey: 'participants',
        header: '참여자',
        cell: cellHelper(({ value }) => (
          <Text className="participants-count">{value?.length || 0}명</Text>
        )),
        size: 100,
        enableSorting: true,
      },
      {
        accessorKey: 'createdAt',
        header: '생성일',
        cell: cellHelper(({ value }) => (
          <Text className="created-at">
            {new Date(value).toLocaleString('ko-KR', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </Text>
        )),
        size: 200,
        enableSorting: true,
        sortingFn: 'datetime',
      },
      {
        accessorKey: 'actions',
        header: '',
        cell: cellHelper(({ rowData }) => (
          <Button
            variant="primary"
            size="md"
            onClick={() => handleJoinRoom(rowData._id, rowData.hasPassword)}
            disabled={connectionStatus !== CONNECTION_STATUS.CONNECTED}
          >
            입장
          </Button>
        )),
        size: 100,
        enableSorting: false,
      },
    ],
    [connectionStatus]
  );

  const tableInstance = useHScrollTable({
    data: rooms,
    columns,
    extraColumnType: 'index',
    useResizeColumn: true,
    sorting,
    setSorting,
    initialSorting: sorting,
  });

  return (
    <div className="chat-container">
      <Card className="chat-rooms-card">
        <Card.Header>
          <div className="flex justify-between items-center">
            <Card.Title>채팅방 목록</Card.Title>
            <div className="flex items-center gap-2">
              <Status
                label={STATUS_CONFIG[connectionStatus].label}
                color={STATUS_CONFIG[connectionStatus].color}
              />
              {(error || connectionStatus === CONNECTION_STATUS.ERROR) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => fetchRooms(false)}
                  disabled={loadingState.loadingMore}
                  className="ml-2"
                >
                  <RefreshCcw className="w-4 h-4" /> 재연결
                </Button>
              )}
            </div>
          </div>
        </Card.Header>

        <Card.Body className="p-6">
          {error && (
            <Alert color={error.type} className="mb-4">
              <div className="flex items-start gap-2">
                {connectionStatus === CONNECTION_STATUS.ERROR ? (
                  <WifiOff className="w-4 h-4 mt-1" />
                ) : (
                  <AlertCircle className="w-4 h-4 mt-1" />
                )}
                <div>
                  <div className="font-medium">{error.title}</div>
                  <div className="mt-1">{error.message}</div>
                  {error.showRetry && !loadingState.loadingMore && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => fetchRooms(false)}
                      className="mt-2"
                    >
                      다시 시도
                    </Button>
                  )}
                </div>
              </div>
            </Alert>
          )}

          {loadingState.loading ? (
            <LoadingIndicator text="채팅방 목록을 불러오는 중..." />
          ) : rooms.length > 0 ? (
            <TableWrapper
              onScroll={handleLoadMore}
              loadingMore={loadingState.loadingMore}
              hasMore={hasMore}
              rooms={rooms}
            >
              {console.log('Rooms passed to TableWrapper:', rooms)}
              <HScrollTable {...tableInstance.getTableProps()} />
            </TableWrapper>
          ) : (
            !error && (
              <div className="chat-rooms-empty">
                <Text className="mb-4">생성된 채팅방이 없습니다.</Text>
                <Button
                  variant="primary"
                  onClick={() => router.push('/chat-rooms/new')}
                  disabled={connectionStatus !== CONNECTION_STATUS.CONNECTED}
                >
                  새 채팅방 만들기
                </Button>
              </div>
            )
          )}
        </Card.Body>
      </Card>
      <Modal
        visible={passwordModalVisible}
        onClose={() => setPasswordModalVisible(false)}
      >
        <div className="modal-content">
          <h2>비밀번호 입력</h2>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="비밀번호를 입력하세요"
          />
          <Button onClick={handlePasswordSubmit}>입장</Button>
          <Button onClick={() => setPasswordModalVisible(false)}>취소</Button>
        </div>
      </Modal>
    </div>
  );
}

const ChatRooms = dynamic(() => Promise.resolve(ChatRoomsComponent), {
  ssr: false,
  loading: () => (
    <div className="auth-container">
      <Card className="chat-rooms-card">
        <Card.Body className="p-6">
          <LoadingIndicator text="로딩 중..." />
        </Card.Body>
      </Card>
    </div>
  ),
});

export default withAuth(ChatRooms);
